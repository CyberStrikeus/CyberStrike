import type { AppleIps } from "../../domain/native/appleIps.js";

type Match = AppleIps["classification"]["matches"][number];

/** SIGKILL codes are compared once, on the canonical hexadecimal form. */
const TERMINATION_CODE_RULES: readonly {
  readonly hex: string;
  readonly rule: Match["rule"];
}[] = [
  { hex: "0x8badf00d", rule: "watchdog" },
  { hex: "0xdead10cc", rule: "dead10cc" },
  { hex: "0xc00010ff", rule: "thermal" },
];

const GUARD_RULES: readonly {
  readonly marker: string;
  readonly rule: Match["rule"];
}[] = [
  { marker: "GUARD_TYPE_FD", rule: "guarded_file_descriptor" },
  { marker: "GUARD_TYPE_MACH_PORT", rule: "guarded_mach_port" },
];

const terminationCodeMatches = (
  code: NonNullable<AppleIps["termination"]>["code"],
): Match[] =>
  code === null
    ? []
    : TERMINATION_CODE_RULES.filter(({ hex }) => code.hex === hex).map(
        ({ rule, hex }) => ({
          rule,
          fields: [
            { name: "termination.code", value: code.decimal },
            { name: "termination.code_hex", value: hex },
          ],
        }),
      );

const exceptionMatches = (exception: AppleIps["exception"]): Match[] => {
  const type = exception?.type ?? null;
  const subtype = exception?.subtype ?? null;
  if (subtype === null) return [];
  const typeField =
    type === null || type === ""
      ? []
      : [{ name: "exception.type", value: type }];
  const fields = [...typeField, { name: "exception.subtype", value: subtype }];
  const matches: Match[] =
    type === "EXC_GUARD"
      ? GUARD_RULES.filter(({ marker }) => subtype.includes(marker)).map(
          ({ rule }) => ({ rule, fields }),
        )
      : [];
  if (subtype.endsWith("(possible pointer authentication failure)"))
    matches.push({ rule: "possible_pointer_authentication_failure", fields });
  return matches;
};

const dyldMatches = (termination: AppleIps["termination"]): Match[] => {
  if (termination?.namespace !== "DYLD") return [];
  const { indicator } = termination;
  const missingLibrary = (termination.reasons ?? []).find((reason) =>
    reason.includes("Library not loaded"),
  );
  if (indicator !== "Library missing" && missingLibrary === undefined)
    return [];
  return [
    {
      rule: "dyld_missing_library",
      fields: [
        { name: "termination.namespace", value: "DYLD" },
        ...(indicator === null || indicator === ""
          ? []
          : [{ name: "termination.indicator", value: indicator }]),
        ...(missingLibrary === undefined
          ? []
          : [{ name: "termination.reasons", value: missingLibrary }]),
      ],
    },
  ];
};

/** Match only documented crash classes against already-parsed report facts. */
export const classify = (
  exception: AppleIps["exception"],
  termination: AppleIps["termination"],
): AppleIps["classification"] => {
  const matches = [
    ...terminationCodeMatches(termination?.code ?? null),
    ...exceptionMatches(exception),
    ...dyldMatches(termination),
  ];
  return {
    status: matches.length === 0 ? "unclassified" : "classified",
    matches,
  };
};
