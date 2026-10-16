// Was die Oberfläche beim Laden erwartet, für Node nachgebildet
const g = globalThis as Record<string, unknown>;
g.navigator ??= { language: 'de', languages: ['de'] };
g.localStorage = { getItem: () => null, setItem() {} };
g.window ??= globalThis;
g.document ??= { createElement: () => ({ getContext: () => null, style: {} }), documentElement: { lang: 'de', dataset: {} } };
