import { isoDate } from "@zetra/engine";

/** Today as YYYY-MM-DD (UTC). */
export const today = () => isoDate(new Date());
