import { createTask, saveTaskFile, listTasks } from './store'

export async function runBenchmark() {
    const count = 100
    for (let i = 0; i < count; i++) {
        const t = await createTask({
            title: `Task ${i}`,
            course: i % 2 === 0 ? 'CS101' : 'MATH201',
            status: i % 3 === 0 ? 'todo' : (i % 3 === 1 ? 'doing' : 'done'),
            dueAt: new Date(Date.now() + (i * 3600000)).toISOString(),
            estMins: 30,
            priority: 1
        })

        if (i % 2 === 0) {
            await saveTaskFile({
                id: `file-${t.id}`,
                taskId: t.id,
                filename: `file-${i}.pdf`,
                originalName: `Original ${i}.pdf`,
                mimeType: 'application/pdf',
                size: 1024,
                uploadedAt: new Date().toISOString()
            })
        }
    }

    // Warm-up
    await listTasks()

    const iterations = 10
    const start = performance.now()
    for (let i = 0; i < iterations; i++) {
        await listTasks()
    }
    const duration = performance.now() - start
    const avg = duration / iterations

    return { total: duration, iterations, avg }
}

if (process.argv[1] && process.argv[1].endsWith('benchmark.ts')) {
    runBenchmark().then(res => {
        console.log(`BENCHMARK_RESULT: total=${res.total.toFixed(2)}ms, iterations=${res.iterations}, avg=${res.avg.toFixed(2)}ms per call`)
    }).catch(console.error)
}
