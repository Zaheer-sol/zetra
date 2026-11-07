# Zeti

Zeti is Zetra's mascot, a friendly blue ledger with a folded corner.

- Official renders, one per expression (transparent, 1254px): `docs/brand/zeti/<mood>.webp`
- `scripts/prepare-zeti.py` turns the renders into web images (`frontend/public/zeti/`, trimmed,
  560px tall). It also finds Zeti's eyes (`frontend/src/components/zeti-eyes.ts`), so the app can
  make Zeti blink. Re-run it whenever the renders change.

In the app, always use the component:

```tsx
import { Zeti } from "@/components/zeti";

<Zeti mood="welcome" size={120} />
```

## How Zeti moves

Zeti stays grounded: there's no bouncing or vertical travel. Instead:

- it **breathes** (a slight stretch from its feet) and **sways** gently in a way that suits the
  mood: a friendly lean for welcome, a happy wiggle for success, a head tilt for curious;
- it **blinks** every few seconds, sometimes twice, on the open-eyed expressions (welcome,
  focused, curious, attention);
- it **turns a little toward the pointer** in 3D on hover;
- it fades in the first time it's seen.

Everything stops with the system "Reduce motion" setting. Zeti is decorative by default; pass
`decorative={false}` when Zeti carries meaning, so it gets alt text.

Real limb animation (waving arms, walking) would need a rigged 3D model or a Rive/Lottie
character file, which a flat render can't provide. If that artwork exists later, it can replace
the image inside the same `Zeti` component without changing any page.

## Moods and where they appear

| Mood | Meaning | Used for |
|---|---|---|
| `welcome` | Hello | Website and Product heroes, sign-in and sign-up, console greeting, first-run empty states, Assistant greeting and avatar |
| `focused` | Working on it | Developers page and Docs home, loading the workspace, onboarding wallet and invoice steps, the Assistant while it works, "add a wallet first" |
| `success` | It worked | Onboarding finish ("ready to pay"), website call to action, the paid-pilot offer on Pricing |
| `curious` | Let's look | Pricing hero ("which plan?"), search with no results, 404, empty developer lists, "Zetra never guesses" on the website |
| `attention` | Something needs you | "Where Zetra fits" on Product, errors ("couldn't load this", the error page, service unavailable) |
| `resting` | All clear | Security page (calm, nothing to worry about), "Nothing needs attention", no notifications, an invoice waiting for payment |

## Guidelines

- One Zeti per view, at the moment it adds warmth (a welcome, an empty state, an error, a win).
  Don't put Zeti in dense tables, forms or financial detail.
- Zeti never appears on the hosted payment page. That page belongs to the merchant and their
  customer, so it stays merchant-branded apart from "Powered by Zetra".
- Use `attention` for problems, never a sad or alarmed Zeti for normal financial states like a
  partial payment. Those are routine, and the UI treats them calmly.
- Don't recolour, stretch or crop Zeti. Size it with `size` (height in px).
