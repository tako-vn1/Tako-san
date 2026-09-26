import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Lock, LockOpen, Plus, RefreshCw, Sparkles, Trash2, Wand2 } from 'lucide-react';
import type {
  AssistProposalDto,
  AutoOptionsDto,
  CompositionOptionDto,
  MealComponentDto,
  MealRole,
  PickerItemDto,
} from '../../../../packages/domain/src/meal-composition-api';
import type { MealPlanDto } from '../../../../packages/domain/src/meal-planning-api';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { mealCompositionApi } from '../../services/meal-composition';
import { mealPlanningApi } from '../../services/meal-planning';
import { ComponentPicker } from './ComponentPicker';
import { compositionCopy, componentTitle, roleLabel, usePlanCompositions } from './composition';
import type { PlannerLocale } from './copy';
import type { usePlanner } from './usePlanner';

// The meal page remounts on every plan revision; this carries focus and the announcement across it.
let pendingFocus: { id: string; message: string } | null = null;

type Picker = { mode: 'add'; role?: MealRole } | { mode: 'swap'; component: MealComponentDto };

export function MealComposer({ plan, slotId, model, locale }: {
  plan: MealPlanDto; slotId: string; model: ReturnType<typeof usePlanner>; locale: PlannerLocale;
}) {
  const c = compositionCopy[locale];
  const query = usePlanCompositions(plan);
  const composition = query.data?.compositions.find((entry) => entry.slotId === slotId);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [proposal, setProposal] = useState<AssistProposalDto | null>(null);
  const [options, setOptions] = useState<AutoOptionsDto | null>(null);
  const [message, setMessage] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const past = plan.freshness.reasons.includes('planning_time_elapsed');

  useEffect(() => {
    if (!pendingFocus || !composition) return;
    const { id, message: text } = pendingFocus;
    pendingFocus = null;
    setMessage(text);
    (document.getElementById(id) ?? heading.current)?.focus();
  }, [composition]);

  async function mutate(label: string, focusId: string, operation: () => Promise<unknown>) {
    const result = await model.perform(label, operation);
    if (!result) return;
    pendingFocus = { id: focusId, message: c.changed };
    setPicker(null); setProposal(null); setOptions(null);
    // Server revision moved: reload the authoritative plan (the composition query is keyed by revision).
    await model.perform('refresh', () => mealPlanningApi.get(plan.id), model.replacePlan);
  }

  function choose(item: PickerItemDto, role: MealRole) {
    const target = item.kind === 'recipe' ? { kind: 'recipe' as const, recipeId: item.id } : { kind: 'simple_food' as const, simpleFoodId: item.id };
    if (picker?.mode === 'swap') {
      const permitted = item.roles.includes(picker.component.role) ? picker.component.role : role;
      void mutate('composition-swap', `component-${picker.component.id}`, () =>
        mealCompositionApi.swap(plan.id, slotId, picker.component.id, { revision: plan.revision, target, role: permitted }));
    } else {
      void mutate('composition-add', 'composition-heading', () =>
        mealCompositionApi.add(plan.id, slotId, { revision: plan.revision, target, role, locked: true }));
    }
  }

  if (query.isPending) return <Card><p role="status" className="text-sm">…</p></Card>;
  if (query.isError || !composition) return null;
  const disabled = !!model.busy || past;
  const components = composition.components;
  return <Card className="!p-5 sm:!p-6" aria-labelledby="composition-heading">
    <h3 id="composition-heading" ref={heading} tabIndex={-1} className="font-heading font-bold text-lg">{c.heading}</h3>
    <p className="text-xs text-semantic-text-muted mt-1">{c.editHint}</p>
    <p role="status" aria-live="polite" className="sr-only">{message}</p>
    {components.length === 0 && <p className="text-sm mt-4">{c.emptyMeal}</p>}
    <ol className="mt-4 space-y-3">
      {components.map((component, index) => <ComponentRow key={component.id} component={component} index={index} count={components.length}
        locale={locale} disabled={disabled}
        onLock={() => void mutate('composition-lock', `lock-${component.id}`, () =>
          mealCompositionApi.update(plan.id, slotId, component.id, { revision: plan.revision, locked: !component.locked }))}
        onRole={(role) => void mutate('composition-role', `component-${component.id}`, () =>
          mealCompositionApi.update(plan.id, slotId, component.id, { revision: plan.revision, role }))}
        onMove={(offset) => void mutate('composition-move', `component-${component.id}`, () =>
          mealCompositionApi.update(plan.id, slotId, component.id, { revision: plan.revision, ordinal: index + offset }))}
        onSwap={() => setPicker({ mode: 'swap', component })}
        onRemove={() => void mutate('composition-remove', 'composition-heading', () =>
          mealCompositionApi.remove(plan.id, slotId, component.id, plan.revision))} />)}
    </ol>
    {[...composition.missingRoles, ...composition.recommendedRoles].slice(0, 2).map((role) =>
      <div key={role} className="mt-3 rounded-xl bg-takosan-mint/60 p-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-takosan-green-deep">{c.missing(roleLabel(role, locale))}</p>
        <Button size="sm" variant="outline" disabled={disabled} aria-label={`${c.addDish}: ${roleLabel(role, locale)}`} onClick={() => setPicker({ mode: 'add', role })}><Plus size={14} className="mr-1" />{c.addDish}</Button>
      </div>)}
    <div className="grid sm:grid-cols-3 gap-2 mt-4">
      <Button variant="secondary" disabled={disabled} onClick={() => setPicker({ mode: 'add' })}><Plus size={16} className="mr-2" />{c.addDish}</Button>
      <Button variant="outline" disabled={disabled} onClick={async () => {
        setOptions(null);
        const result = await model.perform('composition-assist', () => mealCompositionApi.assist(plan.id, slotId, { revision: plan.revision, action: 'complete' }));
        if (result) { setProposal(result); setMessage(c.proposalReady); }
      }}><Sparkles size={16} className="mr-2" />{c.complete}</Button>
      <Button variant="outline" disabled={disabled} onClick={async () => {
        setProposal(null);
        const result = await model.perform('composition-auto', () => mealCompositionApi.auto(plan.id, slotId, { revision: plan.revision }));
        if (result) { setOptions(result); setMessage(c.proposalReady); }
      }}><Wand2 size={16} className="mr-2" />{c.build}</Button>
    </div>
    {proposal && <Suggestions title={c.suggestionTitle} locale={locale} options={proposal.proposal ? [proposal.proposal] : []} disabled={disabled}
      onDismiss={() => setProposal(null)}
      onAccept={(option) => void mutate('composition-assist-apply', 'composition-heading', () => mealCompositionApi.assistApply(plan.id, slotId,
        { revision: plan.revision, action: proposal.action, variant: proposal.variant, proposalId: option.optionId }))} />}
    {options && <Suggestions title={c.options} locale={locale} options={options.options} disabled={disabled} onDismiss={() => setOptions(null)}
      onAccept={(option) => void mutate('composition-auto-apply', 'composition-heading', () => mealCompositionApi.autoApply(plan.id, slotId,
        { revision: plan.revision, variant: options.variant, optionId: option.optionId }))} />}
    {picker && <ComponentPicker locale={locale} busy={!!model.busy} initialRole={picker.mode === 'add' ? picker.role : picker.component.role}
      onChoose={choose} onClose={() => setPicker(null)} />}
  </Card>;
}

function ComponentRow({ component, index, count, locale, disabled, onLock, onRole, onMove, onSwap, onRemove }: {
  component: MealComponentDto; index: number; count: number; locale: PlannerLocale; disabled: boolean;
  onLock: () => void; onRole: (role: MealRole) => void; onMove: (offset: number) => void; onSwap: () => void; onRemove: () => void;
}) {
  const c = compositionCopy[locale];
  const title = componentTitle(component, locale);
  const status = component.projection?.status;
  const statusText = status === 'covered' ? c.covered : status === 'needs_shopping' ? c.needsShopping : status === 'unresolved' ? c.unresolved
    : status === 'not_tracked' ? c.notTracked : null;
  return <li id={`component-${component.id}`} tabIndex={-1} className="rounded-xl border border-semantic-border p-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug">{title}</p>
        <p className="text-xs text-semantic-text-muted mt-1">
          <span className="font-bold uppercase tracking-wide text-takosan-green-deep">{roleLabel(component.role, locale)}</span>
          {component.locked && <span> · {c.locked}</span>}{statusText && <span> · {statusText}</span>}
        </p>
        {!component.resolvable && <p className="text-xs text-semantic-warning-strong mt-1">{c.unavailable}</p>}
      </div>
      <Button id={`lock-${component.id}`} size="sm" variant={component.locked ? 'secondary' : 'ghost'} aria-pressed={component.locked}
        aria-label={`${component.locked ? c.unlock : c.lock}: ${title}`} disabled={disabled} onClick={onLock}>
        {component.locked ? <Lock size={16} aria-hidden="true" /> : <LockOpen size={16} aria-hidden="true" />}
      </Button>
    </div>
    <details className="mt-2 group">
      <summary className="text-xs text-takosan-green-deep underline cursor-pointer min-h-8 inline-flex items-center">{c.swapDish} · {c.remove} · {c.role}</summary>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {component.permittedRoles.length > 1 && <label className="text-xs flex items-center gap-2">{c.role}
          <select id={`role-${component.id}`} value={component.role} disabled={disabled} onChange={(event) => onRole(event.target.value as MealRole)}
            className="min-h-9 rounded-lg border border-semantic-border px-2 bg-white" aria-label={`${c.role}: ${title}`}>
            {component.permittedRoles.map((role) => <option key={role} value={role}>{roleLabel(role, locale)}</option>)}
          </select></label>}
        <Button size="sm" variant="outline" disabled={disabled} aria-label={`${c.swapDish}: ${title}`} onClick={onSwap}><RefreshCw size={14} className="mr-1" />{c.swapDish}</Button>
        <Button size="sm" variant="ghost" disabled={disabled || index === 0} aria-label={`${c.moveUp}: ${title}`} onClick={() => onMove(-1)}><ArrowUp size={14} /></Button>
        <Button size="sm" variant="ghost" disabled={disabled || index === count - 1} aria-label={`${c.moveDown}: ${title}`} onClick={() => onMove(1)}><ArrowDown size={14} /></Button>
        <Button size="sm" variant="ghost" disabled={disabled} aria-label={`${c.remove}: ${title}`} onClick={onRemove}><Trash2 size={14} /></Button>
      </div>
      <div className="mt-2 text-xs">
        {component.cookable && component.recipeId ? <span className="flex gap-3">
          <Link className="underline min-h-8 inline-flex items-center" to={`/recipes/id/${encodeURIComponent(component.recipeId)}`}>{c.detail}</Link>
          <Link className="underline min-h-8 inline-flex items-center" to={`/cooking/${encodeURIComponent(component.recipeId)}`}>{c.cook}</Link>
        </span> : component.kind === 'simple_food' ? <span className="text-semantic-text-muted">{c.noCooking}</span> : null}
      </div>
    </details>
  </li>;
}

function Suggestions({ title, locale, options, disabled, onAccept, onDismiss }: {
  title: string; locale: PlannerLocale; options: CompositionOptionDto[]; disabled: boolean;
  onAccept: (option: CompositionOptionDto) => void; onDismiss: () => void;
}) {
  const c = compositionCopy[locale];
  const reason = (entry: CompositionOptionDto['explanations'][number]) => {
    if (entry.code === 'ROLE_ADDED') return c.roleAdded(roleLabel(entry.role!, locale));
    if (entry.code === 'ROLE_UNFILLED') return c.roleUnfilled(roleLabel(entry.role!, locale));
    return c.reasons[entry.code](entry.count ?? 0);
  };
  return <section aria-label={title} className="mt-4 rounded-xl border border-takosan-mint-deep bg-takosan-mint/40 p-4 space-y-3">
    <div className="flex items-center justify-between gap-2"><h4 className="font-heading font-bold">{title}</h4>
      <Button size="sm" variant="ghost" onClick={onDismiss}>{c.dismiss}</Button></div>
    <p className="text-xs text-semantic-text-secondary">{c.suggestionNote}</p>
    {options.length === 0 && <p className="text-sm">{c.noSuggestion}</p>}
    {options.map((option, index) => <div key={option.optionId} className="rounded-xl bg-white p-3 border border-semantic-border">
      {options.length > 1 && <p className="text-xs font-bold text-takosan-green-deep mb-2">{c.option} {index + 1}</p>}
      <ul className="space-y-1 text-sm">{option.components.map((item) => <li key={`${item.kind}:${item.recipeId ?? item.simpleFoodId}`} className="flex justify-between gap-2">
        <span>{componentTitle({ kind: item.kind, simpleFoodId: item.simpleFoodId, title: item.title }, locale)}</span>
        <span className="text-xs text-semantic-text-muted shrink-0">{roleLabel(item.role, locale)} · {item.existingComponentId ? c.kept : c.added}</span></li>)}</ul>
      {option.removedComponentIds.length > 0 && <p className="text-xs text-semantic-warning-strong mt-2">{c.removedLabel}</p>}
      <ul className="mt-2 space-y-0.5 text-xs text-semantic-text-secondary">{option.explanations.map((entry, position) => <li key={position}>{reason(entry)}</li>)}</ul>
      <Button size="sm" className="mt-3" disabled={disabled} onClick={() => onAccept(option)}>{c.accept}</Button>
    </div>)}
  </section>;
}
