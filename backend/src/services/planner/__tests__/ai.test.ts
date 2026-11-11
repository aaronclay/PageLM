import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../../lib/ai/ask', () => ({
    handleAsk: vi.fn()
}))

import { calculateUrgencyScore } from '../ai'
import { Task } from '../types'

describe('calculateUrgencyScore', () => {
    const fixedNow = new Date('2026-03-01T12:00:00.000Z')

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(fixedNow)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    function createTask(overrides: Partial<Task> = {}): Task {
        return {
            id: 'task-1',
            title: 'Test Task',
            dueAt: new Date(fixedNow.getTime() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
            estMins: 60,
            priority: 3,
            status: 'todo',
            createdAt: fixedNow.toISOString(),
            updatedAt: fixedNow.toISOString(),
            ...overrides
        }
    }

    it('calculates expected score with balanced parameters (24h deadline, priority 3, 60m effort)', () => {
        // timeToDeadline = 24h -> urgencyScore = 1 / 1 = 1.0 (weight 0.5 -> 0.5)
        // priority = 3/5 = 0.6 (weight 0.3 -> 0.18)
        // effort = 60/240 = 0.25 (weight 0.2 -> 0.05)
        // total = 0.5 + 0.18 + 0.05 = 0.73
        const task = createTask({
            dueAt: new Date(fixedNow.getTime() + 24 * 60 * 60 * 1000).toISOString(),
            priority: 3,
            estMins: 60
        })

        const score = calculateUrgencyScore(task)
        expect(score).toBeCloseTo(0.73, 5)
    })

    it('returns maximum score (1.0) when urgency is max (due in <= 24h), priority is 5, and effort >= 240m', () => {
        // urgency: due in 1 hour -> timeToDeadline / 24 < 1 -> urgencyScore = 1.0 (0.5 * 1.0 = 0.5)
        // priority: 5 / 5 = 1.0 (0.3 * 1.0 = 0.3)
        // effort: 240 / 240 = 1.0 (0.2 * 1.0 = 0.2)
        // total = 0.5 + 0.3 + 0.2 = 1.0
        const task = createTask({
            dueAt: new Date(fixedNow.getTime() + 60 * 60 * 1000).toISOString(),
            priority: 5,
            estMins: 240
        })

        const score = calculateUrgencyScore(task)
        expect(score).toBeCloseTo(1.0, 5)
    })

    it('caps effort score at 1.0 for tasks taking longer than 240 minutes', () => {
        const task240 = createTask({ estMins: 240 })
        const task480 = createTask({ estMins: 480 })

        const score240 = calculateUrgencyScore(task240)
        const score480 = calculateUrgencyScore(task480)

        expect(score480).toBe(score240)
    })

    it('handles overdue tasks gracefully by capping urgency score at 1.0', () => {
        // When dueAt is in the past, dueTime - now < 0, clamped to Math.max(1, dueTime - now) = 1 ms.
        // timeToDeadline = 1 / (1000 * 60 * 60) hours.
        // urgencyScore = 1 / Math.max(1, timeToDeadline / 24) = 1 / 1 = 1.0.
        const pastTask = createTask({
            dueAt: new Date(fixedNow.getTime() - 24 * 60 * 60 * 1000).toISOString()
        })
        const dueNowTask = createTask({
            dueAt: fixedNow.toISOString()
        })

        const pastScore = calculateUrgencyScore(pastTask)
        const dueNowScore = calculateUrgencyScore(dueNowTask)

        expect(pastScore).toBeCloseTo(dueNowScore, 5)
    })

    it('decreases score as deadline is further in the future', () => {
        const task1Day = createTask({
            dueAt: new Date(fixedNow.getTime() + 24 * 60 * 60 * 1000).toISOString()
        })
        const task2Days = createTask({
            dueAt: new Date(fixedNow.getTime() + 48 * 60 * 60 * 1000).toISOString()
        })
        const task7Days = createTask({
            dueAt: new Date(fixedNow.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
        })

        const score1Day = calculateUrgencyScore(task1Day)
        const score2Days = calculateUrgencyScore(task2Days)
        const score7Days = calculateUrgencyScore(task7Days)

        // For 48h deadline: timeToDeadline / 24 = 2 -> urgencyScore = 1 / 2 = 0.5.
        // Difference from 1 day urgency score: (1.0 - 0.5) * 0.5 = 0.25 decrease.
        expect(score1Day).toBeGreaterThan(score2Days)
        expect(score2Days).toBeGreaterThan(score7Days)
        expect(score1Day - score2Days).toBeCloseTo(0.25, 4)
    })

    it('scales proportionally with priority levels (1 to 5)', () => {
        const taskPriority1 = createTask({ priority: 1 })
        const taskPriority5 = createTask({ priority: 5 })

        const scoreP1 = calculateUrgencyScore(taskPriority1)
        const scoreP5 = calculateUrgencyScore(taskPriority5)

        // Difference is (5/5 - 1/5) * 0.3 = 0.8 * 0.3 = 0.24
        expect(scoreP5 - scoreP1).toBeCloseTo(0.24, 5)
    })

    it('handles zero effort minutes correctly', () => {
        const taskZeroEffort = createTask({ estMins: 0, priority: 5 })
        // urgency: 1.0 * 0.5 = 0.5
        // priority: 1.0 * 0.3 = 0.3
        // effort: 0/240 * 0.2 = 0.0
        // total = 0.8
        const score = calculateUrgencyScore(taskZeroEffort)
        expect(score).toBeCloseTo(0.8, 5)
    })

    it('ranks urgent impending tasks higher than low priority distant tasks', () => {
        const urgentTask = createTask({
            id: 'urgent',
            dueAt: new Date(fixedNow.getTime() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours
            priority: 5,
            estMins: 120
        })

        const lowPriorityDistantTask = createTask({
            id: 'distant',
            dueAt: new Date(fixedNow.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days
            priority: 1,
            estMins: 30
        })

        expect(calculateUrgencyScore(urgentTask)).toBeGreaterThan(calculateUrgencyScore(lowPriorityDistantTask))
    })
})
