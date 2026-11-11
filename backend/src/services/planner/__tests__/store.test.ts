import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTask, getTask, updateTask, deleteTask, listTasks, saveTaskFile, getTaskFiles } from '../store'
import db from '../../../utils/database/keyv'

describe('Planner Store', () => {
    beforeEach(async () => {
        if (db.clear) {
            await db.clear()
        } else {
            await db.delete('planner:tasks')
            await db.delete('planner:task_files')
        }
    })

    afterEach(async () => {
        if (db.clear) {
            await db.clear()
        } else {
            await db.delete('planner:tasks')
            await db.delete('planner:task_files')
        }
    })

    it('returns empty list when no tasks exist', async () => {
        const tasks = await listTasks()
        expect(tasks).toEqual([])
    })

    it('creates, retrieves, and lists tasks properly sorted by dueAt', async () => {
        const t1 = await createTask({
            title: 'Task 1',
            course: 'MATH101',
            status: 'todo',
            dueAt: new Date('2026-05-10T12:00:00Z').toISOString(),
            estMins: 30,
            priority: 2
        })

        const t2 = await createTask({
            title: 'Task 2',
            course: 'CS101',
            status: 'done',
            dueAt: new Date('2026-05-01T12:00:00Z').toISOString(),
            estMins: 45,
            priority: 1
        })

        const t3 = await createTask({
            title: 'Task 3',
            course: 'CS101',
            status: 'doing',
            dueAt: new Date('2026-05-05T12:00:00Z').toISOString(),
            estMins: 60,
            priority: 3
        })

        const tasks = await listTasks()
        expect(tasks.length).toBe(3)
        // sorted by dueAt ascending
        expect(tasks[0].id).toBe(t2.id)
        expect(tasks[1].id).toBe(t3.id)
        expect(tasks[2].id).toBe(t1.id)
    })

    it('filters tasks by status, course, and dueBefore', async () => {
        await createTask({
            title: 'Task A',
            course: 'MATH101',
            status: 'todo',
            dueAt: new Date('2026-05-01T12:00:00Z').toISOString(),
            estMins: 30,
            priority: 2
        })

        await createTask({
            title: 'Task B',
            course: 'CS101',
            status: 'doing',
            dueAt: new Date('2026-05-15T12:00:00Z').toISOString(),
            estMins: 45,
            priority: 1
        })

        await createTask({
            title: 'Task C',
            course: 'CS101',
            status: 'todo',
            dueAt: new Date('2026-05-20T12:00:00Z').toISOString(),
            estMins: 60,
            priority: 3
        })

        const statusFiltered = await listTasks({ status: 'todo' })
        expect(statusFiltered.length).toBe(2)
        expect(statusFiltered.map(t => t.title)).toEqual(['Task A', 'Task C'])

        const courseFiltered = await listTasks({ course: 'CS101' })
        expect(courseFiltered.length).toBe(2)
        expect(courseFiltered.map(t => t.title)).toEqual(['Task B', 'Task C'])

        const dueBeforeFiltered = await listTasks({ dueBefore: '2026-05-10T00:00:00Z' })
        expect(dueBeforeFiltered.length).toBe(1)
        expect(dueBeforeFiltered[0].title).toBe('Task A')

        const combinedFiltered = await listTasks({ status: 'todo', course: 'CS101' })
        expect(combinedFiltered.length).toBe(1)
        expect(combinedFiltered[0].title).toBe('Task C')
    })

    it('attaches files to tasks correctly', async () => {
        const task = await createTask({
            title: 'Task with files',
            status: 'todo',
            dueAt: new Date('2026-05-01T12:00:00Z').toISOString(),
            estMins: 30,
            priority: 1
        })

        const file1 = {
            id: 'file-1',
            taskId: task.id,
            filename: 'test1.pdf',
            originalName: 'test1.pdf',
            mimeType: 'application/pdf',
            size: 512,
            uploadedAt: new Date().toISOString()
        }

        const file2 = {
            id: 'file-2',
            taskId: task.id,
            filename: 'test2.pdf',
            originalName: 'test2.pdf',
            mimeType: 'application/pdf',
            size: 1024,
            uploadedAt: new Date().toISOString()
        }

        await saveTaskFile(file1)
        await saveTaskFile(file2)

        const tasks = await listTasks()
        expect(tasks.length).toBe(1)
        expect(tasks[0].files).toHaveLength(2)
        expect(tasks[0].files?.map(f => f.id)).toContain('file-1')
        expect(tasks[0].files?.map(f => f.id)).toContain('file-2')

        const singleTask = await getTask(task.id)
        expect(singleTask?.files).toHaveLength(2)
    })

    it('handles tasks in list that were deleted or missing in db', async () => {
        const t1 = await createTask({
            title: 'Valid Task',
            status: 'todo',
            dueAt: new Date('2026-05-01T12:00:00Z').toISOString(),
            estMins: 30,
            priority: 1
        })

        // Manually insert an orphaned ID into LIST_KEY
        const list = (await db.get('planner:tasks')) || []
        list.push({ id: 'non-existent-task-id' })
        await db.set('planner:tasks', list)

        const tasks = await listTasks()
        expect(tasks.length).toBe(1)
        expect(tasks[0].id).toBe(t1.id)
    })
})
