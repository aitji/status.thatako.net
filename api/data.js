/**
 * use?
 *  : GET /api/data?file=metrics.json
 *  : GET /api/data?file=uptime.json
 *  : GET /api/data?file=incidents/index.json
 *  : GET /api/data?file=incidents/2025-03-01-dns-delays.md
 */

const REPO_OWNER = 'aitji'
const REPO_NAME = 'status.thatako.net'
const DATA_BRANCH = 'data'

/**@type {{[x: number]: {data: string;cachedAt: number}}}*/
const cache = {}
const CACHE_TTL_MS = 5 * 60 * 1000 // 5min

const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${DATA_BRANCH}`
const ALLOWED_PATTERN = /^(metrics\.json|uptime\.json|incidents\/index\.json|incidents\/[\w\-]+\.md)$/

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' })

    const { file } = req.query
    if (!file) return res.status(400).json({ error: 'missing ?file= param' })
    if (!ALLOWED_PATTERN.test(file)) return res.status(400).json({ error: 'file not allowed' })

    const now = Date.now()
    const cached = cache[file]

    if (cached && (now - cached.cachedAt) < CACHE_TTL_MS) {
        res.setHeader('X-Cache', 'HIT')
        res.setHeader('X-Cache-Age', Math.floor((now - cached.cachedAt) / 1000) + 's')
        return sendFile(res, file, cached.data)
    }

    // github
    try {
        const url = `${RAW_BASE}/${file}`
        const upstream = await fetch(url, {
            headers: {
                'User-Agent': 'status.thatako.net/1.0',
                ...(process.env.GITHUB_TOKEN
                    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
                    : {}),
            },
        })

        if (!upstream.ok) {
            // github 404s :-;;
            if (upstream.status === 404) {
                const empty = defaultEmpty(file)
                res.setHeader('X-Cache', 'MISS-404')
                return sendFile(res, file, empty)
            }
            return res.status(upstream.status).json({ error: 'upstream error', status: upstream.status })
        }

        const text = await upstream.text()
        cache[file] = { data: text, cachedAt: now }

        res.setHeader('X-Cache', 'MISS')
        return sendFile(res, file, text)
    } catch (err) {
        console.error('[data api] fetch error:', err)
        return res.status(502).json({ error: 'failed to fetch from github' })
    }
}

function sendFile(res, file, text) {
    const isJson = file.endsWith('.json')
    res.setHeader('Content-Type', isJson ? 'application/json' : 'text/plain; charset=utf-8')
    // cache 2min : revalidate
    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=300')
    return res.status(200).send(text);
}

function defaultEmpty(file) {
    if (file === 'metrics.json') return JSON.stringify({ 'go.thatako.net': [], 'dns.thatako.net': [], 'thatako.net': [] })
    if (file === 'uptime.json') return JSON.stringify({ 'go.thatako.net': {}, 'dns.thatako.net': {}, 'thatako.net': {} })
    if (file === 'incidents/index.json') return JSON.stringify([])
    return ''
}