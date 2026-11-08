import z from '@deepseek-ai/schemastery';

const group = () => z.object({
  order: z.array(z.string()).default([]),
  hidden: z.array(z.string()).default([]),
  names: z.dict(z.string()).default({}),
});

// A volatile field is persisted by DSH settings without restarting the plugin
// for each edit. Absence is distinct from explicit empty preferences, so v1
// browser preferences can be migrated once without overriding existing config.
export const Config = z.object({
  preferences: z.object({sidebar: group(), settings: group()})
    .default(null).extra('volatile', true),
});
export const inject = ['settings'];
export function apply(ctx) {
  ctx.effect(() => ctx.settings.configure({auto: false}));
}
