/**
 * The narration, in the languages a voice is likely to speak.
 *
 * Counts are not here: the cue speaks the numeral, "7", and every voice reads a
 * numeral in its own language — "sept", "sieben", "なな" — which is free
 * multilingual counting.
 *
 * Picked by the voice's language prefix, so `fr-CA` gets French. A voice in a
 * language not listed falls back to English, which it will read with its own
 * accent: worth hearing, and better than silence.
 */
export type Block = 'welcome' | 'instruction'

export const PHRASES: Record<string, Record<Block, string[]>> = {
  en: {
    welcome: [
      'Welcome. This is the narrator.',
      'Every minute begins with a count to ten.',
      'Listen for the bells: one when I begin, a tinkle on each word, and a low bell when I stop.',
    ],
    instruction: ['Now, a short instruction.', 'Hold the phone still, and wait for the next minute.'],
  },
  fr: {
    welcome: [
      'Bienvenue. Ici le narrateur.',
      'Chaque minute commence par un compte jusqu’à dix.',
      'Écoutez les cloches : une quand je commence, un tintement à chaque mot, et une cloche grave quand je m’arrête.',
    ],
    instruction: [
      'Maintenant, une courte consigne.',
      'Tenez le téléphone immobile, et attendez la minute suivante.',
    ],
  },
  de: {
    welcome: [
      'Willkommen. Hier spricht der Erzähler.',
      'Jede Minute beginnt damit, dass ich bis zehn zähle.',
      'Achten Sie auf die Glocken: eine, wenn ich beginne, ein Klingeln bei jedem Wort, und eine tiefe Glocke, wenn ich aufhöre.',
    ],
    instruction: [
      'Jetzt eine kurze Anweisung.',
      'Halten Sie das Telefon still, und warten Sie auf die nächste Minute.',
    ],
  },
  es: {
    welcome: [
      'Bienvenidos. Habla el narrador.',
      'Cada minuto empieza con una cuenta hasta diez.',
      'Escuche las campanas: una cuando empiezo, un tintineo en cada palabra, y una campana grave cuando termino.',
    ],
    instruction: [
      'Ahora, una instrucción breve.',
      'Mantenga el teléfono quieto, y espere al próximo minuto.',
    ],
  },
  it: {
    welcome: [
      'Benvenuti. Parla il narratore.',
      'Ogni minuto comincia con un conto fino a dieci.',
      'Ascoltate le campane: una quando comincio, un tintinnio a ogni parola, e una campana grave quando finisco.',
    ],
    instruction: [
      'Ora, una breve istruzione.',
      'Tenete fermo il telefono, e aspettate il prossimo minuto.',
    ],
  },
  ja: {
    welcome: [
      'ようこそ。こちらはナレーターです。',
      '毎分、まず十まで数えます。',
      '鐘を聞いてください。話し始めると一つ、言葉ごとに小さな音、終わると低い鐘が鳴ります。',
    ],
    instruction: ['では、短い指示です。', '電話を動かさずに、次の一分を待ってください。'],
  },
  zh: {
    welcome: [
      '欢迎。我是旁白。',
      '每一分钟都从数到十开始。',
      '请听铃声：我开始时响一声，每个词有一声轻响，我结束时响一声低沉的钟。',
    ],
    instruction: ['现在，一个简短的指示。', '请拿稳手机，等待下一分钟。'],
  },
}

export function phrasesFor(lang: string): Record<Block, string[]> {
  return PHRASES[lang.toLowerCase().split(/[-_]/)[0]!] ?? PHRASES['en']!
}
