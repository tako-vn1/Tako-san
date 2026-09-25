import { z } from 'zod';
import { PlanIdSchema } from '../../../packages/domain/src/meal-planning-api';
import {
  AddComponentSchema,
  AssistApplySchema,
  AssistProposalDtoSchema,
  AssistRequestSchema,
  AutoApplySchema,
  AutoOptionsDtoSchema,
  AutoRequestSchema,
  ComponentIdSchema,
  CompositionSlotIdSchema,
  PickerPageDtoSchema,
  PickerQuerySchema,
  PlanCompositionsDtoSchema,
  SlotCompositionDtoSchema,
  SwapComponentSchema,
  UpdateComponentSchema,
} from '../../../packages/domain/src/meal-composition-api';
import { fetchJson } from './http';

/** T20 composition client: validates every request before sending and every response before use. */
const planPath = (id: string) => `/meal-planning/plans/${encodeURIComponent(PlanIdSchema.parse(id))}`;
const slotPath = (id: string, slotId: string) => `${planPath(id)}/slots/${encodeURIComponent(CompositionSlotIdSchema.parse(slotId))}`;
const componentPath = (id: string, slotId: string, componentId: string) =>
  `${slotPath(id, slotId)}/components/${encodeURIComponent(ComponentIdSchema.parse(componentId))}`;

async function request<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, options?: RequestInit): Promise<T> {
  return schema.parse(await fetchJson<unknown>(path, { ...options, cache: 'no-store' }));
}
const send = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const slotResult = (id: string, slotId: string, revision: number) => SlotCompositionDtoSchema.refine(
  (dto) => dto.planId === id && dto.composition.slotId === slotId && dto.planRevision > revision, 'Composition revision mismatch');

export const mealCompositionApi = {
  plan(id: string) {
    return request(`${planPath(id)}/compositions`, PlanCompositionsDtoSchema.refine((dto) => dto.planId === id, 'Plan identity mismatch'));
  },
  add(id: string, slotId: string, input: z.input<typeof AddComponentSchema>) {
    return request(`${slotPath(id, slotId)}/components`, slotResult(id, slotId, input.revision), send('POST', AddComponentSchema.parse(input)));
  },
  swap(id: string, slotId: string, componentId: string, input: z.input<typeof SwapComponentSchema>) {
    return request(`${componentPath(id, slotId, componentId)}/swap`, slotResult(id, slotId, input.revision),
      send('POST', SwapComponentSchema.parse(input)));
  },
  update(id: string, slotId: string, componentId: string, input: z.input<typeof UpdateComponentSchema>) {
    return request(componentPath(id, slotId, componentId), slotResult(id, slotId, input.revision), send('PATCH', UpdateComponentSchema.parse(input)));
  },
  remove(id: string, slotId: string, componentId: string, revision: number) {
    return request(`${componentPath(id, slotId, componentId)}?revision=${z.number().int().positive().parse(revision)}`,
      slotResult(id, slotId, revision), { method: 'DELETE' });
  },
  assist(id: string, slotId: string, input: z.input<typeof AssistRequestSchema>) {
    return request(`${slotPath(id, slotId)}/assist`, AssistProposalDtoSchema.refine((dto) => dto.planId === id && dto.slotId === slotId
      && dto.planRevision === input.revision, 'Proposal scope mismatch'), send('POST', AssistRequestSchema.parse(input)));
  },
  assistApply(id: string, slotId: string, input: z.input<typeof AssistApplySchema>) {
    return request(`${slotPath(id, slotId)}/assist/apply`, slotResult(id, slotId, input.revision), send('POST', AssistApplySchema.parse(input)));
  },
  auto(id: string, slotId: string, input: z.input<typeof AutoRequestSchema>) {
    return request(`${slotPath(id, slotId)}/auto`, AutoOptionsDtoSchema.refine((dto) => dto.planId === id && dto.slotId === slotId
      && dto.planRevision === input.revision, 'Options scope mismatch'), send('POST', AutoRequestSchema.parse(input)));
  },
  autoApply(id: string, slotId: string, input: z.input<typeof AutoApplySchema>) {
    return request(`${slotPath(id, slotId)}/auto/apply`, slotResult(id, slotId, input.revision), send('POST', AutoApplySchema.parse(input)));
  },
  picker(query: z.input<typeof PickerQuerySchema>) {
    const parsed = PickerQuerySchema.parse(query);
    const params = new URLSearchParams(Object.entries(parsed).filter(([, value]) => value !== undefined && value !== '') as [string, string][]);
    return request(`/meal-planning/compositions/picker${params.size ? `?${params}` : ''}`, PickerPageDtoSchema);
  },
};
