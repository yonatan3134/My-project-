const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/** True when most of the words are Hebrew, Arabic or another right-to-left script. */
export const isRtl = (words: string[]) =>
  words.filter((word) => RTL.test(word)).length > words.length / 2;

export const directionOf = (text: string) =>
  isRtl(text.split(/\s+/).filter(Boolean)) ? "rtl" : "ltr";
