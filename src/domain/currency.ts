// Homely currently stores and displays household money in rand.
// Keep the agent's context explicit; models cannot see the UI's formatter.
export const HOUSEHOLD_CURRENCY = {
  code: "ZAR",
  name: "South African rand",
  symbol: "R",
  locale: "en-ZA",
  minorUnitsPerMajor: 100
} as const;

export const CURRENCY_INSTRUCTIONS = `Household currency context:
- Homely's recorded currency is ${HOUSEHOLD_CURRENCY.name} (${HOUSEHOLD_CURRENCY.code}), displayed with ${HOUSEHOLD_CURRENCY.symbol}. Use it for household costs, totals, estimates and unqualified budgets; do not ask which currency to use when this context already answers that question.
- All stored monetary fields ending in _cents or Cents are integer rand cents: divide by ${HOUSEHOLD_CURRENCY.minorUnitsPerMajor} for display and multiply rand amounts by ${HOUSEHOLD_CURRENCY.minorUnitsPerMajor} for proposal payloads. For example, 45000 cents is R450.00, and a R500 budget is 50000 cents. Preserve cents when relevant.
- Prefer prices quoted in ZAR for product research. Keep a source's explicit foreign currency visible; never relabel a foreign amount as rand or silently mix currencies in a total. Convert only with a sourced exchange rate, identifying the rate and date; otherwise leave the original currency and explain the limitation.
- Preserve currency markings and amounts in file evidence. If a file's currency is ambiguous, say so rather than claiming it is ZAR. The household default is not proof of a document's currency.
- Currency context does not establish the home's precise location. Continue to require a user-supplied location for local service searches.`;
