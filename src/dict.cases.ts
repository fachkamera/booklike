/** One lookup expectation: which headword the bundle must surface for a selection. */
export interface DictCase {
  /** The selected text, spelled as the reader sees it. */
  word: string
  /**
   * What `hasDeliberateCapital` would report for the selection: a capital the sentence
   * did not force. Both readings of the same word are separate cases.
   */
  cap?: boolean
  /** Expected resolved headword, or null when nothing should surface. */
  w: string | null
}

export const DICT_CASES: DictCase[] = [
  // A respelling must not win over the proper noun the reader selected.
  { word: 'Paris', w: 'Paris' },
  { word: 'Paris', cap: true, w: 'Paris' },
  { word: 'paris', w: 'pari' },

  // Inflected forms resolve to their lemma, not to a same-spelling homograph.
  { word: 'follows', w: 'follow' },
  { word: 'mice', w: 'mouse' },
  { word: 'leaves', w: 'leaf' },
  { word: 'children', w: 'child' },
  { word: 'ran', w: 'run' },

  // Forms that stand alone keep their own entry instead of redirecting.
  { word: 'better', w: 'better' },
  { word: 'running', w: 'running' },
  { word: 'worse', w: 'worse' },
  { word: 'data', w: 'data' },

  // A capital only outranks the lowercase entry when the sentence did not force it.
  { word: 'Turkey', w: 'turkey' },
  { word: 'Turkey', cap: true, w: 'Turkey' },
  { word: 'Apple', w: 'apple' },
  { word: 'Apple', cap: true, w: 'Apple' },
  { word: 'Mouse', w: 'mouse' },
  { word: 'Bush', cap: true, w: 'Bush' },

  // All caps is a deliberate spelling; an inner capital is exact-match only.
  { word: 'NATO', w: 'NATO' },
  { word: 'iOS', w: null },

  // Regular and irregular inflections resolve to the lemma holding the definitions.
  { word: 'cities', w: 'city' },
  { word: 'boxes', w: 'box' },
  { word: 'knives', w: 'knife' },
  { word: 'halves', w: 'half' },
  { word: 'wolves', w: 'wolf' },
  { word: 'geese', w: 'goose' },
  { word: 'feet', w: 'foot' },
  { word: 'teeth', w: 'tooth' },
  { word: 'went', w: 'go' },
  { word: 'been', w: 'be' },
  { word: 'met', w: 'meet' },
  { word: 'criteria', w: 'criterion' },

  // The lemma is the one the reader means, not whichever the extract happened to list
  // first: "restarted" is a euphemism for "retarded" as well as the past of "restart".
  { word: 'restarted', w: 'restart' },
  { word: 'fscked', w: 'fsck' },
  { word: 'lumbers', w: 'lumber' },
  { word: 'mos', w: 'mo' },
  { word: 'secretest', w: 'secret' },
  { word: 'nonplused', w: 'nonplus' },
  { word: 'grannies', w: 'granny' },

  // A form whose first-listed lemma missed the vocabulary cut still resolves through
  // one that survived, rather than dropping out of the bundle altogether.
  { word: 'skies', w: 'sky' },
  { word: 'candies', w: 'candy' },
  { word: 'paralyzes', w: 'paralyze' },
  { word: 'electrolyses', w: 'electrolysis' },
  { word: 'baristi', w: 'barista' },
  { word: 'tooken', w: 'take' },

  // Participles and superlatives that are words in their own right keep their entry.
  { word: 'loving', w: 'loving' },
  { word: 'dying', w: 'dying' },
  { word: 'winged', w: 'winged' },
  { word: 'evening', w: 'evening' },
  { word: 'marketing', w: 'marketing' },
  { word: 'gambling', w: 'gambling' },
  { word: 'clothes', w: 'clothes' },
  { word: 'best', w: 'best' },
  { word: 'worst', w: 'worst' },

  // Forms that inflect two lemmas surface only one.
  { word: 'axes', w: 'ax' },
  { word: 'bases', w: 'base' },
  { word: 'ellipses', w: 'ellipse' },
  { word: 'lives', w: 'live' },
  { word: 'does', w: 'do' },

  { word: 'zzzzq', w: null },
]
