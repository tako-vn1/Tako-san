import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { MealRole, PickerItemDto } from '../../../../packages/domain/src/meal-composition-api';
import { MEAL_ROLES } from '../../../../packages/domain/src/meal-composition-api';
import { Button } from '../../components/common/Button';
import { useModalFocus } from '../../design-system/use-modal-focus';
import { mealCompositionApi } from '../../services/meal-composition';
import { compositionCopy, componentTitle, roleLabel } from './composition';
import type { PlannerLocale } from './copy';
import { PlannerError } from './PlannerShell';

/**
 * Server-paged dish picker (summary DTOs only). Choosing calls `onChoose`; closing performs no
 * mutation. Bottom sheet on small screens, centred dialog from `sm` up.
 */
export function ComponentPicker({ locale, initialRole, busy, onChoose, onClose }: {
  locale: PlannerLocale; initialRole?: MealRole; busy: boolean;
  onChoose: (item: PickerItemDto, role: MealRole) => void; onClose: () => void;
}) {
  const c = compositionCopy[locale];
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<MealRole | ''>(initialRole ?? '');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PickerItemDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useModalFocus(true, panel, () => { if (!busy) onClose(); }, searchRef);

  async function load(reset: boolean, from: string | null) {
    setLoading(true); setError(null);
    try {
      const page = await mealCompositionApi.picker({ role: role || undefined, q: query.trim() || undefined,
        cursor: reset ? undefined : from ?? undefined, limit: '20' });
      setItems((prior) => (reset ? page.items : [...prior, ...page.items]));
      setCursor(page.nextCursor);
      setTotal(page.total);
    } catch (failure) { setError(failure); }
    finally { setLoading(false); }
  }
  // Debounced server search; each filter change restarts from the first page.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(true, null), 200);
    return () => window.clearTimeout(timer);
  }, [role, query]);

  return <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-semantic-overlay/50">
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
      className="w-full sm:max-w-lg max-h-[88dvh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white shadow-xl">
      <div className="p-4 sm:p-5 border-b border-semantic-border/70 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id={titleId} className="font-heading font-bold text-lg">{c.pickerTitle}</h2>
          <Button variant="ghost" aria-label={c.close} disabled={busy} onClick={onClose}><X size={18} /></Button>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <label className="relative flex-1">
            <span className="sr-only">{c.search}</span>
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-semantic-text-muted" aria-hidden="true" />
            <input ref={searchRef} type="search" value={query} maxLength={80} onChange={(event) => setQuery(event.target.value)}
              placeholder={c.search} className="w-full min-h-11 rounded-xl border border-semantic-border pl-9 pr-3 text-sm" />
          </label>
          <label className="sm:w-44">
            <span className="sr-only">{c.role}</span>
            <select value={role} onChange={(event) => setRole(event.target.value as MealRole | '')}
              className="w-full min-h-11 rounded-xl border border-semantic-border px-3 text-sm bg-white">
              <option value="">{c.allRoles}</option>
              {MEAL_ROLES.map((value) => <option key={value} value={value}>{roleLabel(value, locale)}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="overflow-y-auto p-4 sm:p-5 flex-1">
        {!!error && <PlannerError error={error} locale={locale} onRetry={() => void load(true, null)} />}
        <p role="status" className="sr-only">{loading ? '…' : `${total}`}</p>
        {!loading && !error && items.length === 0 && <p className="text-sm text-semantic-text-secondary">{c.noResults}</p>}
        <ul className="space-y-2">
          {items.map((item) => {
            const chosenRole = role && item.roles.includes(role) ? role : item.roles[0];
            const title = componentTitle(item, locale);
            return <li key={`${item.kind}:${item.id}`} className="border border-semantic-border rounded-xl p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{title}</p>
                <p className="text-xs text-semantic-text-muted mt-0.5">{item.roles.map((value) => roleLabel(value, locale)).join(' · ')}
                  {item.cookTimeMinutes !== null && ` · ${item.cookTimeMinutes}′`}</p>
                {item.constraintState === 'unknown' && <p className="text-xs text-semantic-warning-strong mt-0.5">{c.safetyUnknown}</p>}
              </div>
              <Button size="sm" variant="secondary" disabled={busy} aria-label={`${c.choose}: ${title}`}
                onClick={() => onChoose(item, chosenRole)}>{c.choose}</Button>
            </li>;
          })}
        </ul>
        {cursor && <Button variant="outline" fullWidth className="mt-3" disabled={loading} onClick={() => void load(false, cursor)}>{c.loadMore}</Button>}
      </div>
    </div>
  </div>;
}
