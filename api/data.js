/**
 * use?
 *  : GET /api/status
 *  returns bundled metrics, uptime, incidents
 */

const REPO_OWNER = 'aitji'
const REPO_NAME = 'status.thatako.net'
const DATA_BRANCH = 'data'
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${DATA_BRANCH}`
const CACHE_TTL = 5 * 60 * 1000 // 5min

const SERVICES = ['go.thatako.net', 'workers.thatako.net', 'thatako.net']

/**@type {{bundle: object, at: number} | null}*/
let cache = null

async function rawFetch(path) {
    const res = await fetch(`${RAW_BASE}/${path}`, {
        headers: {
            'User-Agent': 'status.thatako.net/1.0',
            ...(process.env.GITHUB_TOKEN
                ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
                : {}),
        },
    })
    if (!res.ok) return null
    return res.text()
}

/**@param {string} text @param {any} fallback*/
function safeJSON(text, fallback) {
    try { return JSON.parse(text) }
    catch { return fallback }
}

async function buildBundle() {
    // fetch metrics + uptime + incident index in parallel
    const [metricsRaw, uptimeRaw, incIndexRaw] = await Promise.all([
        rawFetch('metrics.json'),
        rawFetch('uptime.json'),
        rawFetch('incidents/index.json'),
    ])

    const metrics = safeJSON(metricsRaw, Object.fromEntries(SERVICES.map(s => [s, []])))
    const uptime = safeJSON(uptimeRaw, Object.fromEntries(SERVICES.map(s => [s, {}])))
    const incIndex = safeJSON(incIndexRaw, [])

    // 10 most recent
    const sorted = [...incIndex]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 10)

    const bodies = await Promise.all(sorted.map(item => rawFetch(`incidents/${item.file}`)))
    const incidents = sorted.map((item, i) => ({
        date: item.date,
        title: item.title,
        auto: item.auto ?? false,
        body: bodies[i] ?? '',
    }))

    return { metrics, uptime, incidents }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' })

    const now = Date.now()

    if (cache && (now - cache.at) < CACHE_TTL) {
        res.setHeader('X-Cache', 'HIT')
        res.setHeader('X-Cache-Age', Math.floor((now - cache.at) / 1000) + 's')
    } else {
        try {
            cache = { bundle: await buildBundle(), at: now }
            res.setHeader('X-Cache', 'MISS')
        } catch (err) {
            console.error('[status api] build error:', err)

            if (cache) res.setHeader('X-Cache', 'STALE')
            else return res.status(502).json({ error: 'failed to fetch data' })
        }
    }

    // cache 2min : revalidate
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=300')
    return res.status(200).json(cache.bundle)
}