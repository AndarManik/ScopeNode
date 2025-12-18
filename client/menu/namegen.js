const comps = [
  "omn",
  "syn",
  "tek",
  "kor",
  "tri",
  "neo",
  "axi",
  "pro",
  "sol",
  "orb",
  "dyn",
  "uln",
  "cry",
  "inv",
  "vox",
  "qua",
  "ars",
  "dom",
  "vex",
  "rex",
  "mor",
  "sec",
  "vel",
  "rad",
  "zen",
  "tau",
  "kai",
  "pol",
  "fex",
  "gri",
  "bex",
  "cyt",
  "ser",
  "bio",
  "gen",
  "neu",
  "nan",
  "ast",
  "lum",
  "ion",
  "vol",
  "pha",
  "nit",
  "com",
  "sys",
  "lab",
  "man",
  "mod",
  "ops",
  "con",
  "arm",
  "drv",
  "lex",
  "dat",
  "rax",
  "tor",
  "gon",
  "tro",
  "nex",
  "max",
  "vek",
  "zer",
  "tac",
  "ron",
  "ium",
  "car",
  "dra",
  "ark",
  "oth",
  "mir",
  "nos",
  "zar",
  "lux",
  "ryn",
  "ias",
  "vus",
  "ith",
];

const num = "0123456789";
const alpha = "abcdefghijklmnopqrstuvwxyz";

export const couldBeLobbyCode = (str) => {
  if (str.length < 4) return false;
  const dashIndex = str.lastIndexOf("-");
  if (dashIndex === -1) return false;
  const comp = str.slice(0, dashIndex);
  const tail = str.slice(dashIndex + 1);
  if (!comps.includes(comp)) return false;
  if (tail.length !== 2) return false;
  const [letter, digit] = tail;
  if (!alpha.includes(letter)) return false;
  if (!num.includes(digit)) return false;
  return true;
};
