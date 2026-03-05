#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

const SERVICES = [
    'go.thatako.net',
    'dns.thatako.net',
    'thatako.net',
]

const MAX_METRICS_AGE_H = 24  // hours - rolling window
const MAX_UPTIME_AGE_D = 31  // days  - calendar window
const TIMEOUT_MS = 8000

// helper
const nowSec = () => Math.floor(Date.now() / 1000)
const todayKey = () => new Date().toISOString().split('T')[0]

function readJSON(filePath, fallback) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) }
    catch { return fallback }
}

function writeJSON(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

// ping pong!
function ping(host) {
    return new Promise((resolve) => {
        const url = host.startsWith('http') ? host : `https://${host}`
        const lib = url.startsWith('https') ? https : http
        const t0 = Date.now()

        const req = lib.get(url, { timeout: TIMEOUT_MS }, (res) => {
            res.resume() // drain body
            resolve({ ms: Date.now() - t0, up: res.statusCode < 500 })
        })

        req.on('timeout', () => { req.destroy(); resolve({ ms: TIMEOUT_MS, up: false }) })
        req.on('error', () => resolve({ ms: TIMEOUT_MS, up: false }))
    })
}



async function main() {
    const now = nowSec()
    const today = todayKey()

    // existing data
    let metrics = readJSON('metrics.json', {})
    let uptime = readJSON('uptime.json', {})

    console.log('checking services...')
    const results = {}
    for (const svc of SERVICES) {
        const r = await ping(svc)
        console.log(`  ${svc} . . . ${r.ms}ms  up=${r.up}`)
        results[svc] = r
    }

    // update metrics
    const cutoffMetrics = now - MAX_METRICS_AGE_H * 3600
    for (const svc of SERVICES) {
        if (!metrics[svc]) metrics[svc] = []
        metrics[svc] = metrics[svc].filter(e => e.t > cutoffMetrics)
        metrics[svc].push({ t: now, ms: results[svc].ms, up: results[svc].up })
    }

    // update uptime | 31 day
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - MAX_UPTIME_AGE_D)
    const cutoffKey = cutoffDate.toISOString().split('T')[0]

    for (const svc of SERVICES) {
        if (!uptime[svc]) uptime[svc] = {}

        for (const key of Object.keys(uptime[svc])) // decay
            if (key < cutoffKey) delete uptime[svc][key]
        if (!uptime[svc][today]) // upsert today
            uptime[svc][today] = { uptime: 0, checks: 0, down: 0 }

        const day = uptime[svc][today]
        day.checks++
        if (!results[svc].up) day.down++
        day.uptime = parseFloat(
            (((day.checks - day.down) / day.checks) * 100).toFixed(2)
        )
    }

    // auto incident
    const downSvcs = SERVICES.filter(s => !results[s].up)
    if (downSvcs.length > 0) {
        fs.mkdirSync('incidents', { recursive: true })
        const incidentFile = `incidents/${today}-outage.md`

        // only create once per day
        if (!fs.existsSync(incidentFile)) {
            const affected = downSvcs.join(', ')
            const timestamp = new Date().toUTCString()

            const body = [
                `# outage detected: ${today}`,
                '',
                `**affected services:** ${affected}`,
                '',
                `auto-detected by status monitor at ${timestamp}`,
                '',
                '*this incident was auto created.*',
            ].join('\n')

            fs.writeFileSync(incidentFile, body)
            console.log(`created incident: ${incidentFile}`)

            // update incidents/index.json
            let index = readJSON('incidents/index.json', [])
            if (!index.find(i => i.file === `${today}-outage.md`)) {
                index.push({
                    date: today,
                    file: `${today}-outage.md`,
                    title: `Outage detected: ${affected}`,
                    auto: true,
                })
                writeJSON('incidents/index.json', index)
            }
        }
    }


    writeJSON('metrics.json', metrics)
    writeJSON('uptime.json', uptime)
    console.log('done!')
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})