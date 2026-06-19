import { tokens } from "../tokens";

const preset = {
  theme: {
    extend: {
      colors: tokens.colors,
      borderRadius: tokens.radius,
      boxShadow: tokens.shadows,
      fontFamily: {
        display: [tokens.fontFamily.display],
        sans: [tokens.fontFamily.sans],
        title: [tokens.fontFamily.title]
      },
      screens: tokens.breakpoints
    }
  }
};

export default preset;
