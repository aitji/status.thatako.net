const API = 'https://status.thatako.net/api/data'
const SERVICES = [
    'thatako.net', 'status.thatako.net', 'go.thatako.net',
    'workers.thatako.net', 'workers.thatako.net/dns'
]
const DAYS = 31

async function loadAll() {
    try {
        const r = await fetch(API)
        return r.ok ? r.json() : null
    } catch { return null }
}

function timeAgo(date) {
    const s = (Date.now() - date) / 1000
    if (s < 60) return Math.round(s) + 's ago'
    if (s < 3600) return Math.round(s / 60) + 'm ago'
    if (s < 86400) return Math.round(s / 3600) + 'h ago'
    return Math.round(s / 86400) + 'd ago'
}

function drawSparkline(canvas, data, color) {
    const dpr = window.devicePixelRatio || 1
    const W = canvas.offsetWidth || 760, H = canvas.offsetHeight || 44
    canvas.width = W * dpr
    canvas.height = H * dpr

    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)
    if (!data || data.length < 2) {
        ctx.strokeStyle = '#d0d0d0'
        ctx.lineWidth = 1

        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(0, H / 2)
        ctx.lineTo(W, H / 2)
        ctx.stroke()
        return
    }

    const vals = data.map(d => d.ms), min = Math.min(...vals), max = Math.max(...vals) || 1, pad = 4
    const x = i => (i / (data.length - 1)) * W
    const y = v => pad + ((max - v) / ((max - min) || 1)) * (H - pad * 2)
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, color + '30')
    grad.addColorStop(1, color + '00')
    ctx.fillStyle = grad

    ctx.beginPath()
    ctx.moveTo(x(0), y(vals[0]))
    for (let i = 1; i < vals.length; i++) ctx.lineTo(x(i), y(vals[i]))

    ctx.lineTo(x(vals.length - 1), H)
    ctx.lineTo(x(0), H)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(x(0), y(vals[0]))

    for (let i = 1; i < vals.length; i++) ctx.lineTo(x(i), y(vals[i]))
    ctx.stroke()
}

function renderServices(metrics) {
    const list = document.getElementById('services-list')
    list.innerHTML = ''
    let allOk = true, anyDown = false
    SERVICES.forEach((svc, idx) => {
        const data = metrics?.[svc] || [], latest = data[data.length - 1]
        const ms = latest?.ms ?? null, up = latest?.up ?? null
        let bc, bt, lc
        if (up === null) {
            bc = 'badge-unk'
            bt = 'unknown'
            lc = '#aaaaaa'
        } else if (!up) {
            bc = 'badge-down'
            bt = 'outage'
            lc = '#ed4245'
            anyDown = true
            allOk = false
        } else if (ms > 1500) {
            bc = 'badge-warn'
            bt = 'degraded'
            lc = '#faa61a'
            allOk = false
        } else {
            bc = 'badge-up'
            bt = 'operational'
            lc = '#3ba55c'
        }

        const fastest = data.length ? Math.min(...data.map(d => d.ms)) : null
        const oldest = data[0]?.t ? new Date(data[0].t * 1000) : null
        const card = document.createElement('div')
        card.className = 'service-card'
        card.style.animationDelay = idx * 0.07 + 's'
        card.innerHTML = `
            <div class="svc-header">
                <span class="svc-name">${svc}</span>
                <span class="svc-badge ${bc}">${bt}</span>
            </div>

            <div class="svc-stats">
                <div class="stat-item">
                    <span class="stat-label">last check</span>
                    <span class="stat-value">${ms !== null ? ms + ' ms' : '-'}</span>
                </div>
                ${fastest !== null ? `<div class="stat-item">
                    <span class="stat-label">fastest 24h</span>
                    <span class="stat-value">${fastest} ms</span>
                </div>` : ''}
                ${data.length ? `<div class="stat-item">
                    <span class="stat-label">data points</span>
                    <span class="stat-value muted">${data.length}</span>
                </div>` : ''}
            </div>

            <div class="spark-wrap">
                <canvas id="spark-${idx}"></canvas>
            </div>

            <div class="spark-time-row">
                <span class="spark-time">${oldest ? timeAgo(oldest) : '-'}</span>
                <span class="spark-time">now</span>
            </div>`

        list.appendChild(card)
        requestAnimationFrame(() => {
            const c = document.getElementById('spark-' + idx)
            if (c) drawSparkline(c, data, lc)
        })
    })

    const pill = document.getElementById('overall-pill')
    const dot = document.getElementById('overall-dot')
    const lbl = document.getElementById('overall-label')
    if (!metrics) {
        pill.className = 'overall-pill'
        lbl.textContent = 'no data'
    } else if (anyDown) {
        pill.className = 'overall-pill down'
        dot.classList.add('pulse')
        lbl.textContent = 'partial outage'
    } else if (!allOk) {
        pill.className = 'overall-pill warn'
        dot.classList.add('pulse')
        lbl.textContent = 'degraded'
    } else {
        pill.className = 'overall-pill ok'
        dot.classList.add('pulse')
        lbl.textContent = 'operating'
    }
}

function renderUptimeBar(uptime) {
    const grid = document.getElementById('uptime-grid')
    const tip = document.getElementById('uptime-tooltip')
    grid.innerHTML = ''
    const today = new Date()
    const days = []
    for (let i = DAYS - 1; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(today.getDate() - i)
        days.push(d.toISOString().split('T')[0])
    }

    SERVICES.forEach(svc => {
        const block = document.createElement('div')
        block.className = 'uptime-block'

        const lbl = document.createElement('div')
        lbl.className = 'uptime-svc-label'
        lbl.textContent = svc
        block.appendChild(lbl)

        const wrap = document.createElement('div')
        wrap.className = 'uptime-svg-wrap'

        let totalChecks = 0, totalDown = 0
        days.forEach(key => {
            const info = uptime?.[svc]?.[key]
            if (info) {
                totalChecks += info.checks
                totalDown += info.down ?? 0
            }
        })
        const overallPct = totalChecks > 0 ? ((totalChecks - totalDown) / totalChecks * 100).toFixed(2) : null

        const BAR_W = 3, BAR_GAP = 2, STEP = BAR_W + BAR_GAP
        const VB_W = days.length * STEP - BAR_GAP, VB_H = 34
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('preserveAspectRatio', 'none')
        svg.setAttribute('viewBox', `0 0 ${VB_W} ${VB_H}`)

        days.forEach((key, i) => {
            const info = uptime?.[svc]?.[key]
            let fill
            if (!info) fill = 'var(--bar-empty)'
            else if (info.uptime >= 100) fill = 'var(--bar-green)'
            else if (info.uptime >= 95) fill = 'var(--bar-yellow)'
            else fill = 'var(--bar-red)'
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
            rect.setAttribute('x', i * STEP)
            rect.setAttribute('y', 0)
            rect.setAttribute('width', BAR_W)
            rect.setAttribute('height', VB_H)
            rect.setAttribute('fill', fill)
            rect.style.cursor = 'pointer'

            rect.addEventListener('mousemove', e => {
                tip.className = 'uptime-tooltip show'
                tip.innerHTML = info ? `${key} - ${info.uptime.toFixed(1)}% uptime (${info.checks} checks)` : `${key} - no data`
                tip.style.left = (e.clientX + 14) + 'px'
                tip.style.top = (e.clientY - 36) + 'px'
            })
            rect.addEventListener('mouseleave', () => { tip.className = 'uptime-tooltip' })
            svg.appendChild(rect)
        })

        wrap.appendChild(svg)
        block.appendChild(wrap)
        const legend = document.createElement('div')
        legend.className = 'uptime-legend'
        legend.innerHTML = `
            <span class="uptime-legend-side">${DAYS - 1} days ago</span>
            <span class="uptime-legend-center">${overallPct !== null ? overallPct + '% uptime' : 'no data'}</span>
            <span class="uptime-legend-side">today</span>`
        block.appendChild(legend)
        grid.appendChild(block)
    })
}

function renderIncidents(incidents) {
    const list = document.getElementById('incidents-list')
    list.innerHTML = ''
    if (!incidents || incidents.length === 0) {
        list.innerHTML = '<div class="no-data"><i class="fa-regular fa-circle-check"></i> no incidents recorded.</div>'
        return
    }
    incidents.forEach(item => {
        const body = (item.body || '')
            .replace(/^#+ .+\n?/gm, '')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/\n\n+/g, '</p><p>').replace(/\n/g, ' ')
            .trim().replace(/^/, '<p>').replace(/$/, '</p>')
        const card = document.createElement('div')
        card.className = 'incident-card'
        card.innerHTML = `
            <div class="incident-meta">
                <span class="incident-date">${item.date}</span>
                <span class="incident-badge ${item.auto ? 'ibadge-auto' : 'ibadge-manual'}">${item.auto ? 'auto-detected' : 'incident report'}</span>
            </div>
            <div class="incident-title">${item.title}</div>
            <div class="incident-body">${body}</div>`
        list.appendChild(card)
    })
}

async function init() {
    const data = await loadAll()
    renderServices(data?.metrics ?? null)
    renderUptimeBar(data?.uptime ?? null)
    renderIncidents(data?.incidents ?? null)

    const el = document.getElementById('last-updated')
    if (data?.metrics) {
        let latest = 0
        for (const svc of SERVICES) {
            const d = data.metrics[svc] || []
            if (d.length) latest = Math.max(latest, d[d.length - 1].t || 0)
        }

        el.textContent = latest ? 'last updated ' + timeAgo(new Date(latest * 1000)) : 'data loaded'
    } else el.textContent = 'could not load data'
}
init()