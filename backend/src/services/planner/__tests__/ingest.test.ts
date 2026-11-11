import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { ingestText } from "../ingest"

describe("ingestText", () => {
    beforeEach(() => {
        // Fix system time: Wednesday, 2026-03-11 10:00:00 local time
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 2, 11, 10, 0, 0, 0))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe("default values and edge cases", () => {
        it("handles empty string with default values", () => {
            const task = ingestText("")
            expect(task).toEqual({
                course: undefined,
                title: "Task",
                type: undefined,
                notes: undefined,
                dueAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
                estMins: 60,
                priority: 3,
                status: "todo",
                source: { kind: "text" },
                plan: undefined,
                metrics: { sessions: 0, minutesSpent: 0 },
                tags: [],
                rubric: undefined,
            })
        })

        it("handles whitespace-only input", () => {
            const task = ingestText("    ")
            expect(task.title).toBe("Task")
            expect(task.estMins).toBe(60)
        })

        it("handles null or undefined input safely", () => {
            const taskNull = ingestText(null as any)
            expect(taskNull.title).toBe("Task")
            expect(taskNull.estMins).toBe(60)

            const taskUndefined = ingestText(undefined as any)
            expect(taskUndefined.title).toBe("Task")
            expect(taskUndefined.estMins).toBe(60)
        })

        it("falls back to 'Task' when input only contains duration", () => {
            const task = ingestText("~2h")
            expect(task.title).toBe("Task")
            expect(task.estMins).toBe(120)
        })
    })

    describe("duration parsing and title extraction", () => {
        it("parses hours with 'h' and removes it from title", () => {
            const task = ingestText("Study biology 2h")
            expect(task.title).toBe("Study biology")
            expect(task.estMins).toBe(120)
        })

        it("parses hours with 'hr' / 'hrs'", () => {
            const task1 = ingestText("Essay draft 1hr")
            expect(task1.title).toBe("Essay draft")
            expect(task1.estMins).toBe(60)

            const task2 = ingestText("Project work 3 hrs")
            expect(task2.title).toBe("Project work")
            expect(task2.estMins).toBe(180)
        })

        it("parses hours with 'hour' / 'hours'", () => {
            const task1 = ingestText("Read literature 1 hour")
            expect(task1.title).toBe("Read literature")
            expect(task1.estMins).toBe(60)

            const task2 = ingestText("Lab prep 4 hours")
            expect(task2.title).toBe("Lab prep")
            expect(task2.estMins).toBe(240)
        })

        it("parses tilde prefix and fractional hours", () => {
            const task = ingestText("Solve exercises ~1.5h")
            expect(task.title).toBe("Solve exercises")
            expect(task.estMins).toBe(90)
        })

        it("parses minutes with 'm' / 'min' / 'mins' / 'minute' / 'minutes'", () => {
            expect(ingestText("Quick quiz 30m").estMins).toBe(30)
            expect(ingestText("Review flashcards 45min").estMins).toBe(45)
            expect(ingestText("Survey response ~15 mins").estMins).toBe(15)
            expect(ingestText("Short check-in 10 minute").estMins).toBe(10)
            expect(ingestText("Discussion board 20 minutes").estMins).toBe(20)
        })

        it("defaults to 60 mins when no duration is specified", () => {
            const task = ingestText("Physics problem set")
            expect(task.title).toBe("Physics problem set")
            expect(task.estMins).toBe(60)
        })
    })

    describe("due date parsing", () => {
        it("parses ISO YYYY-MM-DD format with default hour 17:00", () => {
            const task = ingestText("Submit thesis 2026-05-20")
            const expectedDate = new Date(2026, 4, 20, 17, 0, 0, 0)
            expect(task.dueAt).toBe(expectedDate.toISOString())
        })

        it("parses YYYY-MM-DD HH:mm format", () => {
            const task = ingestText("Final exam 2026-06-15 09:30")
            const expectedDate = new Date(2026, 5, 15, 9, 30, 0, 0)
            expect(task.dueAt).toBe(expectedDate.toISOString())
        })

        it("parses YYYY-MM-DDTHH:mm format", () => {
            const task = ingestText("Final paper 2026-06-15T14:45")
            const expectedDate = new Date(2026, 5, 15, 14, 45, 0, 0)
            expect(task.dueAt).toBe(expectedDate.toISOString())
        })

        it("parses day of week with time (e.g. Fri 5pm)", () => {
            // Current fake date is Wednesday 2026-03-11 10:00:00 (day = 3)
            // Friday target (day = 5): delta = (5 - 3 + 7) % 7 = 2 days -> 2026-03-13 17:00
            const task = ingestText("Calc homework Fri 5pm 2h")
            const expectedDate = new Date(2026, 2, 13, 17, 0, 0, 0)
            expect(task.dueAt).toBe(expectedDate.toISOString())
            expect(task.estMins).toBe(120)
            expect(task.title).toBe("Calc homework Fri 5pm")
        })

        it("parses same day when target time is later today", () => {
            // Wed 10:00 -> Wed 11pm (23:00)
            // Wed target (day = 3): delta = 0, but (23*60) > (10*60), so delta remains 0 -> same day
            const task = ingestText("Problem set wed 11pm")
            const expectedDate = new Date(2026, 2, 11, 23, 0, 0, 0)
            expect(task.dueAt).toBe(expectedDate.toISOString())
        })

        it("advances 7 days when day matches but time has already passed today", () => {
            // Wed 10:00 -> Wed 9am (09:00). Target time passed today, so delta becomes 7
            const task = ingestText("Weekly check-in wed 9am")
            const expectedDate = new Date(2026, 2, 18, 9, 0, 0, 0)
            expect(task.dueAt).toBe(expectedDate.toISOString())
        })

        it("handles 12am and 12pm correctly", () => {
            // 12am -> 0h
            const taskMidnight = ingestText("Midnight run Fri 12am")
            const expectedMidnight = new Date(2026, 2, 13, 0, 0, 0, 0)
            expect(taskMidnight.dueAt).toBe(expectedMidnight.toISOString())

            // 12pm -> 12h
            const taskNoon = ingestText("Noon lunch Thu 12pm")
            const expectedNoon = new Date(2026, 2, 12, 12, 0, 0, 0)
            expect(taskNoon.dueAt).toBe(expectedNoon.toISOString())
        })

        it("handles relative keywords like 'today', 'tomorrow', 'tmrw', 'by'", () => {
            const taskToday = ingestText("Review notes today 3pm")
            const expectedToday = new Date(2026, 2, 11, 15, 0, 0, 0)
            expect(taskToday.dueAt).toBe(expectedToday.toISOString())

            const taskBy = ingestText("Reading chapter by 4pm")
            const expectedBy = new Date(2026, 2, 11, 16, 0, 0, 0)
            expect(taskBy.dueAt).toBe(expectedBy.toISOString())

            const taskTmrw = ingestText("Assignment tmrw 2:30pm")
            const expectedTmrw = new Date(2026, 2, 11, 14, 30, 0, 0)
            expect(taskTmrw.dueAt).toBe(expectedTmrw.toISOString())
        })

        it("falls back to 24h from now when no due date is specified", () => {
            const task = ingestText("General task without deadline")
            const expectedDate = new Date(Date.now() + 24 * 3600 * 1000)
            expect(task.dueAt).toBe(expectedDate.toISOString())
        })
    })

    describe("complex combined inputs", () => {
        it("parses title, duration, and ISO due date correctly", () => {
            const task = ingestText("CS101 Lab 3 2026-10-15 14:00 ~3h")
            const expectedDate = new Date(2026, 9, 15, 14, 0, 0, 0)
            expect(task.estMins).toBe(180)
            expect(task.dueAt).toBe(expectedDate.toISOString())
            expect(task.title).toBe("CS101 Lab 3 2026-10-15 14:00")
            expect(task.status).toBe("todo")
            expect(task.priority).toBe(3)
            expect(task.source).toEqual({ kind: "text" })
        })
    })
})
