import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock ask module to prevent loading backend/src/config/env.ts when .env is absent
vi.mock('../../../lib/ai/ask', () => ({
  handleAsk: vi.fn(),
}))

import { defaultPolicy, planTask, planTasks, weeklyPlan } from '../scheduler'
import * as aiModule from '../ai'
import { PlanPolicy, Slot, Task } from '../types'

describe('scheduler service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-05-01T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const createMockTask = (overrides: Partial<Task> = {}): Task => ({
    id: 'task-1',
    title: 'Test Homework',
    estMins: 60,
    priority: 3,
    status: 'todo',
    dueAt: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  })

  describe('defaultPolicy', () => {
    it('should return standard default policy when cram is false or omitted', () => {
      const policy1 = defaultPolicy()
      const policy2 = defaultPolicy(false)

      expect(policy1).toEqual({
        pomodoroMins: 25,
        breakMins: 5,
        maxDailyMins: 240,
        cram: false,
      })
      expect(policy2).toEqual(policy1)
    })

    it('should adjust maxDailyMins and cram flag when cram is true', () => {
      const policy = defaultPolicy(true)

      expect(policy).toEqual({
        pomodoroMins: 25,
        breakMins: 5,
        maxDailyMins: 360,
        cram: true,
      })
    })
  })

  describe('planTasks', () => {
    const policy: PlanPolicy = defaultPolicy()

    it('should return an empty array when given an empty list of tasks', () => {
      const result = planTasks([], policy)
      expect(result).toEqual([])
    })

    it('should batch plan multiple tasks and correctly partition slots by taskId', () => {
      const task1 = createMockTask({ id: 'task-1', title: 'Math HW', estMins: 50 })
      const task2 = createMockTask({ id: 'task-2', title: 'Physics Lab', estMins: 25 })

      const mockSlots: Slot[] = [
        {
          id: 'slot-1',
          taskId: 'task-1',
          start: '2025-05-02T10:00:00.000Z',
          end: '2025-05-02T10:25:00.000Z',
          kind: 'focus',
        },
        {
          id: 'slot-2',
          taskId: 'task-2',
          start: '2025-05-02T10:30:00.000Z',
          end: '2025-05-02T10:55:00.000Z',
          kind: 'review',
        },
        {
          id: 'slot-3',
          taskId: 'task-1',
          start: '2025-05-02T11:00:00.000Z',
          end: '2025-05-02T11:25:00.000Z',
          kind: 'review',
        },
      ]

      const makeSlotsSpy = vi.spyOn(aiModule, 'makeSlots').mockReturnValue(mockSlots)

      const planned = planTasks([task1, task2], policy)

      expect(makeSlotsSpy).toHaveBeenCalledWith([task1, task2], policy)
      expect(planned).toHaveLength(2)

      const [plannedTask1, plannedTask2] = planned

      // Check task 1
      expect(plannedTask1.id).toBe('task-1')
      expect(plannedTask1.plan).toBeDefined()
      expect(plannedTask1.plan?.slots).toEqual([mockSlots[0], mockSlots[2]])
      expect(plannedTask1.plan?.policy).toEqual(policy)
      expect(plannedTask1.plan?.lastPlannedAt).toBe('2025-05-01T10:00:00.000Z')

      // Check task 2
      expect(plannedTask2.id).toBe('task-2')
      expect(plannedTask2.plan).toBeDefined()
      expect(plannedTask2.plan?.slots).toEqual([mockSlots[1]])
      expect(plannedTask2.plan?.policy).toEqual(policy)
      expect(plannedTask2.plan?.lastPlannedAt).toBe('2025-05-01T10:00:00.000Z')
    })

    it('should assign empty slots array when makeSlots generates no slots for a task', () => {
      const task1 = createMockTask({ id: 'task-1', status: 'done' })
      const task2 = createMockTask({ id: 'task-2', status: 'todo' })

      const mockSlots: Slot[] = [
        {
          id: 'slot-2',
          taskId: 'task-2',
          start: '2025-05-02T10:00:00.000Z',
          end: '2025-05-02T10:25:00.000Z',
          kind: 'focus',
        },
      ]

      vi.spyOn(aiModule, 'makeSlots').mockReturnValue(mockSlots)

      const planned = planTasks([task1, task2], policy)

      expect(planned[0].plan?.slots).toEqual([])
      expect(planned[1].plan?.slots).toEqual(mockSlots)
    })

    it('should not mutate original task objects', () => {
      const task = createMockTask({ id: 'task-1' })
      const taskCopy = { ...task }

      vi.spyOn(aiModule, 'makeSlots').mockReturnValue([
        {
          id: 'slot-1',
          taskId: 'task-1',
          start: '2025-05-02T10:00:00.000Z',
          end: '2025-05-02T10:25:00.000Z',
          kind: 'focus',
        },
      ])

      const planned = planTasks([task], policy)

      expect(task).toEqual(taskCopy)
      expect(task.plan).toBeUndefined()
      expect(planned[0]).not.toBe(task)
      expect(planned[0].plan).toBeDefined()
    })

    it('should preserve existing task properties when planning', () => {
      const task = createMockTask({
        id: 'task-custom',
        course: 'CS101',
        type: 'project',
        notes: 'Final semester project',
        steps: ['step 1', 'step 2'],
        tags: ['urgent', 'cs'],
      })

      vi.spyOn(aiModule, 'makeSlots').mockReturnValue([])

      const [planned] = planTasks([task], policy)

      expect(planned.course).toBe('CS101')
      expect(planned.type).toBe('project')
      expect(planned.notes).toBe('Final semester project')
      expect(planned.steps).toEqual(['step 1', 'step 2'])
      expect(planned.tags).toEqual(['urgent', 'cs'])
    })

    it('should work end-to-end with real makeSlots implementation', () => {
      const task1 = createMockTask({
        id: 'real-task-1',
        dueAt: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
        estMins: 50,
      })
      const task2 = createMockTask({
        id: 'real-task-2',
        dueAt: new Date(Date.now() + 4 * 24 * 3600 * 1000).toISOString(),
        estMins: 25,
      })

      const planned = planTasks([task1, task2], policy)

      expect(planned).toHaveLength(2)
      expect(planned[0].plan).toBeDefined()
      expect(planned[1].plan).toBeDefined()
      expect(planned[0].plan?.slots.every(s => s.taskId === 'real-task-1')).toBe(true)
      expect(planned[1].plan?.slots.every(s => s.taskId === 'real-task-2')).toBe(true)
    })
  })

  describe('planTask', () => {
    const policy: PlanPolicy = defaultPolicy()

    it('should plan a single task using makeSlots and attach plan', () => {
      const task = createMockTask({ id: 'single-task' })
      const mockSlot: Slot = {
        id: 's-1',
        taskId: 'single-task',
        start: '2025-05-02T10:00:00.000Z',
        end: '2025-05-02T10:25:00.000Z',
        kind: 'focus',
      }

      const makeSlotsSpy = vi.spyOn(aiModule, 'makeSlots').mockReturnValue([mockSlot])

      const planned = planTask(task, policy)

      expect(makeSlotsSpy).toHaveBeenCalledWith([task], policy)
      expect(planned.id).toBe('single-task')
      expect(planned.plan?.slots).toEqual([mockSlot])
      expect(planned.plan?.policy).toEqual(policy)
      expect(planned.plan?.lastPlannedAt).toBe('2025-05-01T10:00:00.000Z')
    })
  })

  describe('weeklyPlan', () => {
    const policy: PlanPolicy = defaultPolicy()

    it('should organize task slots into 7 consecutive days starting from today at midnight', () => {
      const task1 = createMockTask({
        id: 'task-1',
        plan: {
          policy,
          lastPlannedAt: '2025-05-01T10:00:00.000Z',
          slots: [
            {
              id: 'slot-today',
              taskId: 'task-1',
              start: '2025-05-01T14:00:00.000Z',
              end: '2025-05-01T14:25:00.000Z',
              kind: 'focus',
            },
            {
              id: 'slot-day-3',
              taskId: 'task-1',
              start: '2025-05-04T09:00:00.000Z',
              end: '2025-05-04T09:25:00.000Z',
              kind: 'review',
            },
          ],
        },
      })

      const task2 = createMockTask({
        id: 'task-2',
        plan: {
          policy,
          lastPlannedAt: '2025-05-01T10:00:00.000Z',
          slots: [
            {
              id: 'slot-today-earlier',
              taskId: 'task-2',
              start: '2025-05-01T11:00:00.000Z',
              end: '2025-05-01T11:25:00.000Z',
              kind: 'focus',
            },
          ],
        },
      })

      const weekly = weeklyPlan([task1, task2], policy)

      expect(weekly.days).toHaveLength(7)
      expect(weekly.days[0].date).toBe('2025-05-01')
      // Day 0 should contain both slots, sorted by start time
      expect(weekly.days[0].slots).toHaveLength(2)
      expect(weekly.days[0].slots[0].id).toBe('slot-today-earlier')
      expect(weekly.days[0].slots[1].id).toBe('slot-today')

      // Day 3 (2025-05-04)
      expect(weekly.days[3].date).toBe('2025-05-04')
      expect(weekly.days[3].slots).toHaveLength(1)
      expect(weekly.days[3].slots[0].id).toBe('slot-day-3')
    })

    it('should ignore slots outside the 7-day window or tasks without plans', () => {
      const taskWithOutdatedSlot = createMockTask({
        id: 'task-outdated',
        plan: {
          policy,
          lastPlannedAt: '2025-05-01T10:00:00.000Z',
          slots: [
            {
              id: 'slot-past',
              taskId: 'task-outdated',
              start: '2025-04-30T10:00:00.000Z',
              end: '2025-04-30T10:25:00.000Z',
              kind: 'focus',
            },
            {
              id: 'slot-far-future',
              taskId: 'task-outdated',
              start: '2025-05-15T10:00:00.000Z',
              end: '2025-05-15T10:25:00.000Z',
              kind: 'focus',
            },
          ],
        },
      })

      const taskWithoutPlan = createMockTask({ id: 'task-no-plan' })

      const weekly = weeklyPlan([taskWithOutdatedSlot, taskWithoutPlan], policy)

      const totalSlots = weekly.days.reduce((acc, day) => acc + day.slots.length, 0)
      expect(totalSlots).toBe(0)
    })
  })
})
