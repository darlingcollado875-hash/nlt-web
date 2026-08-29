-- Aplicada como migración `nlt_ai_arrays_to_jsonb`.
-- Portabilidad: una sola ruta de código (JSON) entre Postgres (prod) y
-- SQLite (tests). Tablas nlt_ai recién creadas y VACÍAS -> conversión segura.
-- No toca nada fuera de nlt_ai.

alter table nlt_ai.market_context
  alter column data_gaps drop default,
  alter column data_gaps type jsonb using to_jsonb(data_gaps),
  alter column data_gaps set default '[]'::jsonb,
  alter column data_gaps set not null;

alter table nlt_ai.ai_analysis
  alter column confluences           drop default,
  alter column confluences           type jsonb using to_jsonb(confluences),
  alter column confluences           set default '[]'::jsonb,
  alter column confluences           set not null,
  alter column warnings              drop default,
  alter column warnings              type jsonb using to_jsonb(warnings),
  alter column warnings              set default '[]'::jsonb,
  alter column warnings              set not null,
  alter column confirmation_required drop default,
  alter column confirmation_required type jsonb using to_jsonb(confirmation_required),
  alter column confirmation_required set default '[]'::jsonb,
  alter column confirmation_required set not null,
  alter column invalidation          drop default,
  alter column invalidation          type jsonb using to_jsonb(invalidation),
  alter column invalidation          set default '[]'::jsonb,
  alter column invalidation          set not null,
  alter column data_gaps             drop default,
  alter column data_gaps             type jsonb using to_jsonb(data_gaps),
  alter column data_gaps             set default '[]'::jsonb,
  alter column data_gaps             set not null;
