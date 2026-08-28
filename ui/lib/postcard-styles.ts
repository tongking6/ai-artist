export const POSTCARD_STYLES = [
  {
    id: "warm_handmade",
    label: "Warm handmade",
    description: "Natural color, paper texture, soft brush detail, nostalgic mood.",
  },
  {
    id: "manga_zine",
    label: "Manga zine",
    description: "Sparse linework, screen tone, graphic shadows, and quiet framing.",
  },
  {
    id: "impressionist_light",
    label: "Impressionist light",
    description: "Broken brushstrokes and luminous, fleeting color.",
  },
  {
    id: "fauvist_expressive",
    label: "Fauvist expressive",
    description: "Bold color fields, skewed space, and contrasting shadows.",
  },
  {
    id: "childlike_crayon",
    label: "Childlike crayon",
    description: "Wobbly crayon marks, playful scale, and imperfect perspective.",
  },
] as const;

export type PostcardStyle = (typeof POSTCARD_STYLES)[number]["id"];

export const DEFAULT_POSTCARD_STYLE: PostcardStyle = "warm_handmade";

export function postcardStyleLabel(style: PostcardStyle | null): string {
  return POSTCARD_STYLES.find((option) => option.id === style)?.label ?? "Visual style";
}
