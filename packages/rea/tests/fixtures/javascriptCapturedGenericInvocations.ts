const callChains = [
  ["call.call", "other,null"],
  ["apply.call", "other,null,[]"],
  ["call.apply", "other,[null]"],
  ["apply.apply", "other,[null,[]]"],
  ["call.call.call", "other,null"],
] as const;

/** Authored fixtures only; runtime execution is confined to their unit oracle. */
export const capturedGenericInvocations = (["call", "apply"] as const).flatMap(
  (captured) =>
    callChains.flatMap(([chain, arguments_]) =>
      [true, false].map((host) => {
        const local = "({require(){return 'local';}})";
        const expression = `invoke.${chain}(${arguments_}).require('../shared/window.cjs')`;
        return {
          name: `captured ${captured} via ${chain} to ${host ? "host" : "local"}`,
          captured,
          chain,
          host,
          expression,
          source: `const get=()=>${host ? local : "module"};const invoke=get.${captured};const other=()=>${host ? "module" : local};${expression};`,
        };
      }),
    ),
);
