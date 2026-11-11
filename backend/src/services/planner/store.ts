import db from "../../utils/database/keyv"
import crypto from "crypto"
import { Task, TaskFile } from "./types"

const LIST_KEY = "planner:tasks"
const FILES_LIST_KEY = "planner:task_files"

export async function createTask(t: Omit<Task, "id" | "createdAt" | "updatedAt">): Promise<Task> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const task: Task = { ...t, id, createdAt: now, updatedAt: now }
    const list = (await db.get(LIST_KEY)) || []
    list.push({ id })
    await db.set(LIST_KEY, list)
    await db.set(`planner:task:${id}`, task)
    return task
}

export async function getTask(id: string): Promise<Task | null> {
    const task = (await db.get(`planner:task:${id}`)) || null
    if (task) {
        task.files = await getTaskFiles(id)
    }
    return task
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<Task | null> {
    const cur = (await getTask(id))
    if (!cur) return null
    const next: Task = { ...cur, ...patch, id: cur.id, updatedAt: new Date().toISOString() }
    await db.set(`planner:task:${id}`, next)
    return next
}

export async function deleteTask(id: string): Promise<boolean> {
    const list = ((await db.get(LIST_KEY)) || []).filter((x: any) => x.id !== id)
    await db.set(LIST_KEY, list)
    await db.delete(`planner:task:${id}`)
    return true
}

export async function listTasks(filter?: { status?: string; dueBefore?: string; course?: string }): Promise<Task[]> {
    const list: { id: string }[] = (await db.get(LIST_KEY)) || []
    if (list.length === 0) return []

    // Bulk fetch all tasks
    const taskKeys = list.map(it => `planner:task:${it.id}`)
    const fetchedTasks: (Task | undefined | null)[] = await db.getMany(taskKeys)

    // Filter tasks based on query criteria before fetching files to minimize work
    const matchedTasks: Task[] = []
    const matchedTaskIds = new Set<string>()

    for (const t of fetchedTasks) {
        if (!t) continue
        if (filter?.status && t.status !== filter.status) continue
        if (filter?.dueBefore && new Date(t.dueAt) > new Date(filter.dueBefore)) continue
        if (filter?.course && t.course !== filter.course) continue
        matchedTasks.push(t)
        matchedTaskIds.add(t.id)
    }

    if (matchedTasks.length === 0) return []

    // Bulk fetch task files
    const fileList: { id: string; taskId: string }[] = (await db.get(FILES_LIST_KEY)) || []
    const relevantFileEntries = fileList.filter(item => matchedTaskIds.has(item.taskId))

    const filesByTaskId = new Map<string, TaskFile[]>()
    if (relevantFileEntries.length > 0) {
        const fileKeys = relevantFileEntries.map(item => `planner:task_file:${item.id}`)
        const fetchedFiles: (TaskFile | undefined | null)[] = await db.getMany(fileKeys)

        for (const file of fetchedFiles) {
            if (!file) continue
            let files = filesByTaskId.get(file.taskId)
            if (!files) {
                files = []
                filesByTaskId.set(file.taskId, files)
            }
            files.push(file)
        }
    }

    for (const t of matchedTasks) {
        t.files = filesByTaskId.get(t.id) || []
    }

    return matchedTasks.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
}

export async function saveTaskFile(file: TaskFile): Promise<void> {
    const list = (await db.get(FILES_LIST_KEY)) || []
    list.push({ id: file.id, taskId: file.taskId })
    await db.set(FILES_LIST_KEY, list)
    await db.set(`planner:task_file:${file.id}`, file)
}

export async function getTaskFiles(taskId: string): Promise<TaskFile[]> {
    const list = (await db.get(FILES_LIST_KEY)) || []
    const files: TaskFile[] = []
    for (const item of list) {
        if (item.taskId === taskId) {
            const file = await db.get(`planner:task_file:${item.id}`)
            if (file) files.push(file)
        }
    }
    return files
}

export async function deleteTaskFile(id: string): Promise<void> {
    const list = ((await db.get(FILES_LIST_KEY)) || []).filter((x: any) => x.id !== id)
    await db.set(FILES_LIST_KEY, list)
    await db.delete(`planner:task_file:${id}`)
}

export async function deleteTaskFiles(taskId: string): Promise<void> {
    const list = (await db.get(FILES_LIST_KEY)) || []
    const filesToDelete = list.filter((x: any) => x.taskId === taskId)
    const remainingFiles = list.filter((x: any) => x.taskId !== taskId)

    await db.set(FILES_LIST_KEY, remainingFiles)
    for (const file of filesToDelete) {
        await db.delete(`planner:task_file:${file.id}`)
    }
}