/**
 * MixMark · 语言与功能符号目录
 * ===============================================================
 * 与 math-symbols.js 同一套结构，区别只有两点：
 *   1. `math: false` —— 插入时**不**包 $ $，这些是正文字符不是公式
 *   2. 格子直接显示字符本身，不过 KaTeX（字符就是内容，没有源码可言）
 *
 * 顺序即优先级：常用的排在前面。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var CATEGORIES = [
    {
      id: 'zh',
      labelKey: 'symCatZh',
      sections: [
        {
          titleKey: 'symSecZhMark',
          items: [
            '，', '。', '、', '；', '：', '？', '！', '…', '——', '·',
            '～', '－', '／', '＼', '《', '》', '〈', '〉'
          ]
        },
        {
          titleKey: 'symSecZhQuote',
          items: ['「」', '『』', '“”', '‘’', '【】', '〔〕', '（）', '［］', '｛｝', '〈〉', '〖〗', '〘〙']
        },
        {
          titleKey: 'symSecZhMisc',
          items: [
            '〇', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾',
            '㈠', '㈡', '㈢', '㈣', '㈤', '㊀', '㊁', '㊂',
            '№', '㊙', '㊣', '〒', '℃', '℉', '㍿', '㎏', '㎞', '㎜', '㏄', '㏑', '㏒'
          ]
        }
      ]
    },

    {
      id: 'latin',
      labelKey: 'symCatLatin',
      sections: [
        {
          titleKey: 'symSecLatinMark',
          items: [
            ',', '.', ';', ':', '?', '!', '—', '–', '-', '…', '·', '~', '/', '\\', '|',
            '(', ')', '[', ']', '{', '}', '<', '>', '«', '»', '‹', '›'
          ]
        },
        {
          titleKey: 'symSecLatinQuote',
          items: ['“ ”', '‘ ’', '“', '”', '‘', '’', '„', '‟', '′', '″', '‴']
        },
        {
          titleKey: 'symSecAccent',
          items: [
            'á', 'à', 'â', 'ä', 'ã', 'å', 'ā', 'ç', 'ć', 'č',
            'é', 'è', 'ê', 'ë', 'ē', 'ę', 'í', 'ì', 'î', 'ï',
            'ñ', 'ń', 'ó', 'ò', 'ô', 'ö', 'õ', 'ø', 'ō',
            'ú', 'ù', 'û', 'ü', 'ū', 'ý', 'ÿ', 'š', 'ž', 'ł', 'ß', 'æ', 'œ', 'ı', 'đ'
          ]
        },
        {
          titleKey: 'symSecLatinMisc',
          items: ['©', '®', '™', '℠', '℗', '§', '¶', '†', '‡', '•', '◦', '‣', '⁂', '※', '№', '℔', '℥', '℮']
        }
      ]
    },

    {
      id: 'currency',
      labelKey: 'symCatCurrency',
      sections: [
        {
          titleKey: 'symSecCurrencyMain',
          items: ['¥', '$', '€', '£', '₩', '₽', '₹', '₪', '₫', '₴', '¢', '₺', '₦', '₱', '₡', '₲', '₸', '₼', '₾', '₿', '₭', '₮', '₨', '₵', '₶', '₷']
        },
        {
          titleKey: 'symSecCurrencyUnit',
          items: ['元', '角', '分', '圆', '銭', '€/kg', '￥', '＄', '￡', '％', '‰', '‱']
        }
      ]
    },

    {
      id: 'number',
      labelKey: 'symCatNumber',
      sections: [
        {
          titleKey: 'symSecCircled',
          items: ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳']
        },
        {
          titleKey: 'symSecRoman',
          items: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ', 'ⅰ', 'ⅱ', 'ⅲ', 'ⅳ', 'ⅴ', 'ⅵ']
        },
        {
          titleKey: 'symSecFraction',
          items: ['½', '⅓', '⅔', '¼', '¾', '⅕', '⅖', '⅗', '⅘', '⅙', '⅚', '⅛', '⅜', '⅝', '⅞', '⅟', '⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹', '₀', '₁', '₂', '₃', '₄', '₅']
        },
        {
          titleKey: 'symSecBullet',
          items: ['⒈', '⒉', '⒊', '⒋', '⒌', 'Ⓐ', 'Ⓑ', 'Ⓒ', 'Ⓓ', 'ⓐ', 'ⓑ', 'ⓒ', '⒜', '⒝', '⒞', '⑴', '⑵', '⑶', 'Ⅰ．', '一、', '1.', '(1)', '（1）']
        }
      ]
    },

    {
      id: 'symbol',
      labelKey: 'symCatSymbol',
      sections: [
        {
          titleKey: 'symSecCheck',
          items: ['✓', '✔', '✗', '✘', '✕', '✖', '☐', '☑', '☒', '⭕', '❌', '✅', '⚠', '⛔', 'ⓘ', '☞', '☜', '☝']
        },
        {
          titleKey: 'symSecGeometric',
          items: ['■', '□', '▣', '▤', '▥', '▪', '▫', '▲', '△', '▼', '▽', '◆', '◇', '○', '●', '◎', '◯', '◐', '◑', '◒', '◓', '★', '☆', '✦', '✧', '✩', '⯑']
        },
        {
          titleKey: 'symSecCard',
          items: ['♠', '♣', '♥', '♦', '♤', '♡', '♢', '♧', '☀', '☁', '☂', '☃', '❄', '☕', '♪', '♫', '♬', '♭', '♯']
        },
        {
          titleKey: 'symSecArrows',
          items: ['→', '←', '↑', '↓', '↔', '↕', '↖', '↗', '↘', '↙', '⇒', '⇐', '⇔', '⇑', '⇓', '⇕', '⟶', '⟵', '⟷', '➔', '➜', '➤', '▶', '◀', '↵', '↩', '↪', '⇢', '⇠', '⟹', '⟸', '⟺']
        }
      ]
    },

    {
      id: 'key',
      labelKey: 'symCatKey',
      sections: [
        {
          titleKey: 'symSecKeyMod',
          items: ['⌘', '⇧', '⌥', '⌃', '⎇', '⎈', '⏎', '⇥', '⌫', '⌦', '⎋', '␣', '⌤', '⇪', '⇭', '⌧', '⌚', '⌛']
        },
        {
          titleKey: 'symSecKeyKey',
          items: ['Ctrl', 'Shift', 'Alt', 'Meta', 'Cmd', 'Enter', 'Esc', 'Tab', 'Space', 'Backspace', 'Delete', 'F1', 'F2', 'F3', 'F5', 'F12', '↑ ↓ ← →']
        }
      ]
    },

    {
      id: 'measure',
      labelKey: 'symCatMeasure',
      sections: [
        {
          titleKey: 'symSecMeasureOp',
          items: ['±', '∓', '×', '÷', '≠', '≤', '≥', '≈', '≡', '∞', '√', '∑', '∏', '∫', '∂', '∆', '∇', '∝', '∈', '∉', '∪', '∩', '∧', '∨', '¬', '∀', '∃', '∠', '⊥', '∥', '⌐', '°', '′', '″']
        },
        {
          titleKey: 'symSecMeasureUnit',
          items: ['µ', 'Ω', 'Å', '℃', '℉', '°', '‰', '‱', '㎜', '㎝', '㎞', '㎎', '㎏', '㏄', '㎖', '㎡', '㎥', '㎧', '㎨', 'Hz', 'Pa', 'kW', 'kWh', 'dB', 'mol', 'ppm']
        }
      ]
    },

    {
      id: 'bracket',
      labelKey: 'symCatBracket',
      sections: [
        {
          titleKey: 'symSecBracketAll',
          items: ['（）', '()', '[]', '{}', '〈〉', '《》', '「」', '『』', '【】', '〔〕', '〖〗', '〘〙', '〚〛', '❪❫', '❬❭', '❮❯', '❰❱', '⟦⟧', '⟨⟩', '⦅⦆', '⦇⦈', '⌈⌉', '⌊⌋', '| |', '‖ ‖']
        },
        {
          titleKey: 'symSecBracketLine',
          items: ['─', '━', '│', '┃', '┌', '┐', '└', '┘', '├', '┤', '┬', '┴', '┼', '═', '║', '╔', '╗', '╚', '╝', '╠', '╣', '╦', '╩', '╬', '▁', '▔', '▏', '▕']
        }
      ]
    },

    {
      id: 'layout',
      labelKey: 'symCatLayout',
      sections: [
        {
          titleKey: 'symSecLayoutRule',
          items: ['—', '–', '―', '─', '━', '⋯', '…', '···', '***', '___', '///', '\\']
        }
      ]
    }
  ];

  MM.symbolCatalogs = MM.symbolCatalogs || {};
  // math: false —— 插入时不包 $ $，这些是正文字符
  MM.symbolCatalogs.text = { math: false, categories: CATEGORIES };
})();
