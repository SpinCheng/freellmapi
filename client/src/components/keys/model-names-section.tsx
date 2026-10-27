import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { useI18n } from '@/i18n'
import type { Chain } from '@/components/chain-manager'
import type { FallbackEntry } from '@/lib/routing'

// Quick model-id reference for the Keys page (#client-config): filling a model
// into an external client needs the catalog id (e.g. moonshotai/kimi-k3-free),
// not the picker's display name, and /v1/models needs an auth header — so this
// collapsible lists every routable id, click-to-copy. Only entries the router
// can actually serve (enabled + at least one usable key) are listed, matching
// the playground picker's availability rule.
function fmtContext(n?: number | null): string {
  if (!n) return ''
  return n >= 1_048_576 ? `${Math.round(n / 1_048_576)}M` : `${Math.round(n / 1024)}K`
}

// Built-in auto-routing axes (server GLOBAL_SORT_ALIASES). These are code
// constants, not profile rows, so /api/profiles never returns them — listed
// here so `auto:<axis>` stays a copyable first-class model value like the rest.
const BUILTIN_AXES = [
  { id: 'auto:smart', note: 'intelligence' },
  { id: 'auto:fast', note: 'speed' },
  { id: 'auto:cheap', note: 'price' },
  { id: 'auto:reliable', note: 'reliability' },
  { id: 'auto:balanced', note: '' },
]

// Smoke verdicts (settings.smoke_latest via /api/smoke). A model shows here
// only when a recent smoke run served it ok — "configured" (enabled + key) is
// not "reachable", and free pools fail live often enough that the difference
// matters. Ids are normalized (dots/dashes/underscores collapse) because
// /v1/models slugs DB model ids (deepseek-v4.1-flash → deepseek-v4-1-flash).
interface SmokeData {
  testedAt: string | null
  okCount: number
  ok: string[]
}

const normId = (s: string) => s.toLowerCase().replace(/[.\s_]/g, '-')

function ModelNamesSection() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  // Off by default: the curated view is smoke-verified only. Flipping it on
  // lists every configured model, with unverified rows dimmed and tagged so
  // the trust boundary stays visible.
  const [showAll, setShowAll] = useState(false)

  // Same query keys as FallbackPage / Playground / ChainManager — react-query
  // dedupes, so expanding here costs nothing when those pages already ran.
  const { data: entries = [] } = useQuery<FallbackEntry[]>({
    queryKey: ['fallback'],
    queryFn: () => apiFetch('/api/fallback'),
  })
  const { data: chains = [] } = useQuery<Chain[]>({
    queryKey: ['profiles'],
    queryFn: () => apiFetch('/api/profiles'),
  })
  const { data: smoke } = useQuery<SmokeData>({
    queryKey: ['smoke'],
    queryFn: () => apiFetch('/api/smoke'),
  })

  const verified = useMemo(
    () => new Set((smoke?.ok ?? []).map(normId)),
    [smoke],
  )
  const configured = useMemo(
    () => entries.filter(e => e.enabled && e.keyCount > 0),
    [entries],
  )
  const usable = showAll ? configured : configured.filter(e => verified.has(normId(e.modelId)))
  const customChains = useMemo(
    () => chains.filter(c => c.type === 'custom'),
    [chains],
  )
  const hasSmoke = (smoke?.okCount ?? 0) > 0
  const staleDays = smoke?.testedAt
    ? Math.floor((Date.now() - Date.parse(smoke.testedAt)) / 86_400_000)
    : null

  const q = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const match = (s: string) => s.toLowerCase().includes(q)
    const byPlatform = new Map<string, { e: FallbackEntry; unverified: boolean }[]>()
    for (const e of usable) {
      if (q && !match(e.modelId) && !match(e.displayName) && !match(e.platform)) continue
      const list = byPlatform.get(e.platform) ?? []
      list.push({ e, unverified: !verified.has(normId(e.modelId)) })
      byPlatform.set(e.platform, list)
    }
    for (const list of byPlatform.values()) {
      list.sort((a, b) => a.e.modelId.localeCompare(b.e.modelId))
    }
    return [...byPlatform.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [usable, q, verified])

  const chainsShown = q
    ? customChains.filter(c => `auto:${c.name.toLowerCase()}`.includes(q))
    : customChains
  const axesShown = q
    ? BUILTIN_AXES.filter(a => a.id.includes(q))
    : BUILTIN_AXES

  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(id)
      setTimeout(() => setCopied(prev => (prev === id ? null : prev)), 1200)
    } catch { /* clipboard denied — selection still works manually */ }
  }

  const totalShown = groups.reduce((n, [, list]) => n + list.length, 0) + chainsShown.length + axesShown.length

  return (
    <section className="rounded-3xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
        <span className="text-sm font-medium">{t('keys.modelNames.title')}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {showAll
            ? t('keys.modelNames.allCount', { count: usable.length })
            : t('keys.modelNames.verified', { count: usable.length })}
        </span>
        {smoke?.testedAt && (
          <span className={`text-xs ${staleDays !== null && staleDays > 7 ? 'text-amber-500' : 'text-muted-foreground/70'}`}>
            {staleDays !== null && staleDays > 7
              ? t('keys.modelNames.stale')
              : t('keys.modelNames.testedAt', { date: new Date(smoke.testedAt).toLocaleDateString() })}
          </span>
        )}
        <span className="ml-auto hidden truncate text-xs text-muted-foreground sm:block">
          {t('keys.modelNames.subtitle')}
        </span>
      </button>

      {open && (
        <div className="border-t px-4 py-3">
          <div className="mb-3 flex items-center gap-3">
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('keys.modelNames.search')}
              className="h-8"
            />
            <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showAll}
                onChange={e => setShowAll(e.target.checked)}
                className="size-3.5 accent-foreground"
              />
              {t('keys.modelNames.showAll')}
            </label>
          </div>
          {!hasSmoke && (
            <p className="pb-3 text-center text-xs text-amber-500">{t('keys.modelNames.noSmoke')}</p>
          )}
          {totalShown === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">{t('keys.modelNames.empty')}</p>
          )}
          <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
            {axesShown.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('keys.modelNames.builtin')}
                </p>
                <div className="space-y-0.5">
                  {axesShown.map(a => (
                    <ModelRow key={a.id} id={a.id} label={a.note} copied={copied} onCopy={copy} />
                  ))}
                </div>
              </div>
            )}
            {chainsShown.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('keys.modelNames.chains')}
                </p>
                <div className="space-y-0.5">
                  {chainsShown.map(c => {
                    const id = `auto:${c.name.toLowerCase()}`
                    return (
                      <ModelRow key={id} id={id} label={`${c.emoji ? `${c.emoji} ` : ''}${c.name}`} copied={copied} onCopy={copy} />
                    )
                  })}
                </div>
              </div>
            )}
            {groups.map(([platform, list]) => (
              <div key={platform}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {platform} · {list.length}
                </p>
                <div className="space-y-0.5">
                  {list.map(({ e, unverified }) => (
                    <ModelRow
                      key={e.modelDbId}
                      id={e.modelId}
                      label={e.displayName}
                      hint={fmtContext(e.contextWindow)}
                      unverified={unverified}
                      copied={copied}
                      onCopy={copy}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export { ModelNamesSection }

function ModelRow({ id, label, hint, unverified, copied, onCopy }: {
  id: string
  label: string
  hint?: string
  // Only set in show-all mode: configured but not smoke-verified — dimmed and
  // tagged so the trust boundary stays readable at a glance.
  unverified?: boolean
  copied: string | null
  onCopy: (id: string) => void
}) {
  const { t } = useI18n()
  const isCopied = copied === id
  return (
    <button
      type="button"
      onClick={() => onCopy(id)}
      title={id}
      className={`group flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted/60${unverified ? ' opacity-60' : ''}`}
    >
      {isCopied
        ? <Check className="size-3.5 shrink-0 text-emerald-500" />
        : <Copy className="size-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />}
      <code className="shrink-0 text-xs font-medium">{id}</code>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      {unverified
        ? <span className="ml-auto shrink-0 text-[10px] text-amber-500/80">{t('keys.modelNames.unverified')}</span>
        : hint && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{hint}</span>}
      <span className="w-16 shrink-0 text-right text-[10px] text-emerald-500">
        {isCopied ? t('keys.modelNames.copied') : ''}
      </span>
    </button>
  )
}
