/**
 * MixMark · 公式符号目录
 * ===============================================================
 * 纯数据。面板把这里的内容渲染成可点的符号格子，点一下就插进正文。
 *
 * 约定：
 *   1. insert 里的 «» 标出「可替换部分」。插入后第一个 «» 会被**选中**，
 *      所以打完符号可以直接接着敲内容 —— 例如
 *        \dfrac{«x»}{y}   →  光标落在 x 上并选中它
 *      第二个及以后的 «» 只作为提示文字留下（不引入 Tab 跳转，
 *      那需要在编辑器上挂 keymap，为一个符号面板不值当）。
 *   2. 顺序即优先级：每节里最常用的排在前面。节内不再排序。
 *   3. 不在数据里写显示文案 —— 格子本身就是渲染出来的符号（所见即所得），
 *      悬停提示显示将要插入的 LaTeX 源码。省掉几百条翻译，还更准确。
 *   4. 化学式用 mhchem 的 \ce{}，需要 vendor/katex/mhchem.min.js。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var CATEGORIES = [
    /* ================================================================
       数学
       ================================================================ */
    {
      id: 'math',
      labelKey: 'symCatMath',
      sections: [
        {
          titleKey: 'symSecFrac',
          items: [
            '\\frac{«a»}{b}',
            '\\dfrac{«x»}{y}',
            '\\tfrac{«a»}{b}',
            '«a»/«b»',
            '\\sqrt{«x»}',
            '\\sqrt[«n»]{x}',
            '\\frac{\\partial «f»}{\\partial x}',
            '\\left(«x»\\right)'
          ]
        },
        {
          titleKey: 'symSecPower',
          items: [
            '«x»^{«2»}',
            '«x»_{«i»}',
            '«x»_{«i»}^{«2»}',
            '«x»^{-1}',
            '\\times',
            '\\div',
            '\\pm',
            '\\mp',
            '\\cdot',
            '\\ast',
            '\\%',
            '!'
          ]
        },
        {
          titleKey: 'symSecRelation',
          items: [
            '\\neq',
            '\\approx',
            '\\equiv',
            '\\leq',
            '\\geq',
            '\\ll',
            '\\gg',
            '\\sim',
            '\\simeq',
            '\\cong',
            '\\propto',
            '\\ll',
            '\\doteq'
          ]
        },
        {
          titleKey: 'symSecSet',
          items: [
            '\\in',
            '\\notin',
            '\\subset',
            '\\subseteq',
            '\\supset',
            '\\supseteq',
            '\\cup',
            '\\cap',
            '\\setminus',
            '\\emptyset',
            '\\mathbb{R}',
            '\\mathbb{N}',
            '\\mathbb{Z}',
            '\\mathbb{Q}',
            '\\mathbb{C}'
          ]
        },
        {
          titleKey: 'symSecLogic',
          items: [
            '\\forall',
            '\\exists',
            '\\nexists',
            '\\neg',
            '\\land',
            '\\lor',
            '\\implies',
            '\\iff',
            '\\therefore',
            '\\because',
            '\\mathrm{s.t.}'
          ]
        },
        {
          titleKey: 'symSecCalculus',
          items: [
            '\\int',
            '\\int_{«a»}^{«b»}',
            '\\iint',
            '\\iiint',
            '\\oint',
            '\\sum_{«i»=1}^{«n»}',
            '\\prod_{«i»=1}^{«n»}',
            '\\lim_{«x» \\to «0»}',
            '\\frac{\\mathrm{d}«y»}{\\mathrm{d}x}',
            '\\frac{\\mathrm{d}^{2}y}{\\mathrm{d}x^{2}}',
            '\\partial',
            '\\nabla',
            '\\Delta',
            '\\infty',
            '\\mathrm{d}x',
            '\\left[«x»\\right]_{«a»}^{«b»}'
          ]
        },
        {
          titleKey: 'symSecGreekLower',
          items: [
            '\\alpha',
            '\\beta',
            '\\gamma',
            '\\delta',
            '\\epsilon',
            '\\varepsilon',
            '\\zeta',
            '\\eta',
            '\\theta',
            '\\vartheta',
            '\\iota',
            '\\kappa',
            '\\lambda',
            '\\mu',
            '\\nu',
            '\\xi',
            '\\pi',
            '\\rho',
            '\\sigma',
            '\\tau',
            '\\upsilon',
            '\\phi',
            '\\varphi',
            '\\chi',
            '\\psi',
            '\\omega'
          ]
        },
        {
          titleKey: 'symSecGreekUpper',
          items: [
            '\\Gamma',
            '\\Delta',
            '\\Theta',
            '\\Lambda',
            '\\Xi',
            '\\Pi',
            '\\Sigma',
            '\\Upsilon',
            '\\Phi',
            '\\Psi',
            '\\Omega'
          ]
        },
        {
          titleKey: 'symSecArrow',
          items: [
            '\\to',
            '\\rightarrow',
            '\\leftarrow',
            '\\leftrightarrow',
            '\\Rightarrow',
            '\\Leftarrow',
            '\\Leftrightarrow',
            '\\mapsto',
            '\\uparrow',
            '\\downarrow',
            '\\nearrow',
            '\\searrow',
            '\\rightleftharpoons'
          ]
        },
        {
          titleKey: 'symSecBracket',
          items: [
            '\\left|«x»\\right|',
            '\\left\\{«x»\\right\\}',
            '\\lfloor «x» \\rfloor',
            '\\lceil «x» \\rceil',
            '\\langle «x» \\rangle',
            '\\binom{«n»}{«r»}'
          ]
        },
        {
          titleKey: 'symSecMatrix',
          items: [
            '\\begin{pmatrix} «a» & b \\\\ c & d \\end{pmatrix}',
            '\\begin{bmatrix} «a» & b \\\\ c & d \\end{bmatrix}',
            '\\begin{vmatrix} «a» & b \\\\ c & d \\end{vmatrix}',
            '\\begin{cases} «x», & x > 0 \\\\ -x, & x \\leq 0 \\end{cases}',
            '\\begin{aligned} «y» &= x + 1 \\\\ z &= x - 1 \\end{aligned}'
          ]
        },
        {
          titleKey: 'symSecDecorate',
          items: [
            '\\hat{«x»}',
            '\\bar{«x»}',
            '\\overline{«AB»}',
            '\\underline{«x»}',
            '\\vec{«x»}',
            '\\dot{«x»}',
            '\\ddot{«x»}',
            '\\tilde{«x»}',
            '\\widehat{«ABC»}',
            '\\text{«文字»}',
            '\\mathbf{«x»}',
            '\\mathit{«x»}',
            '\\mathcal{«L»}',
            '\\operatorname{«argmax»}'
          ]
        }
      ]
    },

    /* ================================================================
       物理
       ================================================================ */
    {
      id: 'physics',
      labelKey: 'symCatPhysics',
      sections: [
        {
          titleKey: 'symSecPhysicsCommon',
          items: [
            'F = ma',
            'E = mc^{2}',
            'p = mv',
            'v = \\frac{«s»}{t}',
            'a = \\frac{\\Delta v}{\\Delta t}',
            'W = Fs',
            'P = \\frac{«W»}{t}',
            'E_k = \\frac{1}{2}mv^{2}',
            'E_p = mgh',
            'v = f\\lambda',
            'n = \\frac{c}{v}',
            '\\rho = \\frac{m}{V}',
            'F = k\\frac{q_1q_2}{r^{2}}',
            '\\frac{1}{2}kx^{2}',
            'Q = mc\\Delta T',
            'PV = nRT'
          ]
        },
        {
          titleKey: 'symSecVector',
          items: [
            '\\vec{«F»}',
            '\\vec{«v»}',
            '\\vec{«a»}',
            '\\vec{«p»}',
            '\\vec{«E»}',
            '\\vec{«B»}',
            '\\hat{«n»}',
            '\\left|\\vec{«F»}\\right|',
            '\\vec{F} = \\frac{\\mathrm{d}\\vec{p}}{\\mathrm{d}t}',
            '\\frac{\\mathrm{d}«x»}{\\mathrm{d}t}',
            '\\frac{\\mathrm{d}^{2}x}{\\mathrm{d}t^{2}}',
            '\\frac{\\partial «f»}{\\partial t}',
            '\\nabla \\cdot \\vec{«E»}',
            '\\nabla \\times \\vec{«B»}',
            '\\oint \\vec{B} \\cdot \\mathrm{d}\\vec{l}'
          ]
        },
        {
          titleKey: 'symSecConstant',
          items: [
            'c',
            'g',
            'G',
            'h',
            '\\hbar',
            'k_B',
            'R',
            'N_A',
            'e',
            '\\varepsilon_0',
            '\\mu_0',
            '\\lambda',
            '\\phi'
          ]
        },
        {
          titleKey: 'symSecElectro',
          items: [
            'V = IR',
            'P = VI = I^{2}R',
            'qE',
            'qvB',
            'F = BIl',
            'R = \\frac{\\rho L}{A}',
            '\\frac{1}{R} = \\frac{1}{R_1} + \\frac{1}{R_2}',
            '\\Phi = BA',
            '\\varepsilon = -\\frac{\\mathrm{d}\\Phi}{\\mathrm{d}t}',
            'C = \\frac{Q}{V}',
            'E = \\frac{V}{d}',
            '\\tau = RC'
          ]
        },
        {
          titleKey: 'symSecModern',
          items: [
            'E = hf',
            '\\lambda = \\frac{h}{p}',
            '\\Delta x \\Delta p \\geq \\frac{\\hbar}{2}',
            'E = \\Delta m c^{2}',
            'N = N_0 e^{-\\lambda t}',
            't_{1/2} = \\frac{\\ln 2}{\\lambda}',
            'hf = \\phi + E_k',
            'r_n = n^{2}a_0'
          ]
        },
        {
          titleKey: 'symSecWaves',
          items: [
            'y = A\\sin(\\omega t + \\phi)',
            'T = \\frac{1}{f}',
            'v = \\sqrt{\\frac{«T»}{\\mu}}',
            'f\' = f\\frac{v \\pm v_o}{v \\mp v_s}',
            '\\omega = 2\\pi f',
            'k = \\frac{2\\pi}{\\lambda}',
            'd\\sin\\theta = n\\lambda'
          ]
        },
        {
          titleKey: 'symSecUnit',
          items: [
            '\\text{m}',
            '\\text{kg}',
            '\\text{s}',
            '\\text{K}',
            '\\text{mol}',
            '\\text{m/s}',
            '\\text{m/s}^{2}',
            '\\text{N}',
            '\\text{J}',
            '\\text{W}',
            '\\text{Pa}',
            '\\text{Hz}',
            '\\text{V}',
            '\\text{A}',
            '\\Omega',
            '\\text{F}',
            '\\text{T}',
            '\\text{C}',
            '\\text{eV}',
            '^{\\circ}\\text{C}'
          ]
        }
      ]
    },

    /* ================================================================
       化学（mhchem）
       ================================================================ */
    {
      id: 'chemistry',
      labelKey: 'symCatChemistry',
      sections: [
        {
          titleKey: 'symSecSubstance',
          items: [
            '\\ce{H2O}',
            '\\ce{CO2}',
            '\\ce{O2}',
            '\\ce{H2}',
            '\\ce{N2}',
            '\\ce{NaCl}',
            '\\ce{HCl}',
            '\\ce{NaOH}',
            '\\ce{H2SO4}',
            '\\ce{HNO3}',
            '\\ce{CaCO3}',
            '\\ce{NH3}',
            '\\ce{CH4}',
            '\\ce{C2H5OH}',
            '\\ce{C6H12O6}',
            '\\ce{KMnO4}',
            '\\ce{CuSO4}',
            '\\ce{Fe2O3}'
          ]
        },
        {
          titleKey: 'symSecIon',
          items: [
            '\\ce{Na+}',
            '\\ce{Cl-}',
            '\\ce{H+}',
            '\\ce{OH-}',
            '\\ce{SO4^2-}',
            '\\ce{NO3-}',
            '\\ce{CO3^2-}',
            '\\ce{NH4+}',
            '\\ce{Fe^3+}',
            '\\ce{Cu^2+}',
            '\\ce{MnO4-}',
            '\\ce{HCO3-}',
            '\\ce{SO3^2-}',
            '\\ce{PO4^3-}'
          ]
        },
        {
          titleKey: 'symSecReaction',
          items: [
            '\\ce{->}',
            '\\ce{<=>}',
            '\\ce{<->}',
            '\\ce{<=>>}',
            '\\ce{<<=>}',
            '\\ce{->[\\Delta]}',
            '\\ce{->[\\text{催化剂}]}',
            '\\ce{->[\\text{点燃}]}',
            '\\ce{->[\\text{高温}]}',
            '\\ce{->[\\text{通电}]}',
            '\\ce{->[\\text{浓硫酸}]}',
            '\\ce{A + B -> C + D}'
          ]
        },
        {
          titleKey: 'symSecState',
          items: [
            '\\ce{(s)}',
            '\\ce{(l)}',
            '\\ce{(g)}',
            '\\ce{(aq)}',
            '\\uparrow',
            '\\downarrow',
            '\\Delta',
            '\\ce{2H2 + O2 -> 2H2O}'
          ]
        },
        {
          titleKey: 'symSecIsotope',
          items: [
            '\\ce{^{«14»}_{6}C}',
            '\\ce{^{235}_{92}U}',
            '\\ce{^{1}_{1}H}',
            '\\ce{^{«1»}_{1}H}',
            '\\ce{^{2}_{1}H}',
            '\\ce{^{3}_{1}H}',
            '\\ce{e-}'
          ]
        },
        {
          titleKey: 'symSecOrganic',
          items: [
            '\\ce{CH3-CH2-OH}',
            '\\ce{CH3COOH}',
            '\\ce{-COOH}',
            '\\ce{-OH}',
            '\\ce{-CHO}',
            '\\ce{-NH2}',
            '\\ce{C=C}',
            '\\ce{C#C}',
            '\\ce{C6H6}',
            '\\ce{CH3COOCH2CH3}',
            '\\ce{->[\\text{聚合}]}',
            '\\ce{[CH2-CH2]_n}'
          ]
        },
        {
          titleKey: 'symSecChemCalc',
          items: [
            'n = \\frac{«m»}{M}',
            'c = \\frac{«n»}{V}',
            'V = n \\times 22.4',
            '\\mathrm{pH} = -\\lg[\\ce{H+}]',
            '\\mathrm{pOH} = -\\lg[\\ce{OH-}]',
            '\\mathrm{pH} + \\mathrm{pOH} = 14',
            'K_c',
            'K_a',
            'K_w',
            'K_{sp}',
            '\\Delta H',
            '\\Delta G = \\Delta H - T\\Delta S',
            '\\mathrm{mol/L}',
            '\\mathrm{g/mol}',
            'w = \\frac{m_{\\text{溶质}}}{m_{\\text{溶液}}} \\times 100\\%'
          ]
        }
      ]
    },

    /* ================================================================
       统计学
       ================================================================ */
    {
      id: 'statistics',
      labelKey: 'symCatStatistics',
      sections: [
        {
          titleKey: 'symSecDescribe',
          items: [
            '\\bar{«x»}',
            '\\mu',
            '\\sigma',
            '\\sigma^{2}',
            's',
            's^{2}',
            'n',
            '\\sum «x»',
            '\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n}x_i',
            '\\sigma = \\sqrt{\\frac{\\sum (x_i - \\mu)^{2}}{n}}',
            's = \\sqrt{\\frac{\\sum (x_i - \\bar{x})^{2}}{n - 1}}',
            '\\mathrm{Q}_1',
            '\\mathrm{Q}_3',
            '\\mathrm{IQR}',
            '\\mathrm{median}',
            '\\mathrm{mode}'
          ]
        },
        {
          titleKey: 'symSecProb',
          items: [
            'P(«A»)',
            'P(A \\mid B)',
            'P(A \\cap B)',
            'P(A \\cup B)',
            'P(A\')',
            'P(A \\mid B) = \\frac{P(A \\cap B)}{P(B)}',
            'P(A \\cup B) = P(A) + P(B) - P(A \\cap B)',
            '\\binom{«n»}{«r»}',
            'n!',
            '{}^{n}P_{r}',
            '{}^{n}C_{r}',
            '\\mathrm{E}[X] = \\sum x P(x)',
            '\\mathrm{Var}(X) = \\mathrm{E}[X^{2}] - \\mu^{2}',
            '1 - P(A)'
          ]
        },
        {
          titleKey: 'symSecDist',
          items: [
            'X \\sim \\mathrm{N}(\\mu, \\sigma^{2})',
            'X \\sim \\mathrm{B}(n, p)',
            'X \\sim \\mathrm{Po}(\\lambda)',
            'X \\sim \\chi^{2}(k)',
            'X \\sim t(n)',
            'X \\sim \\mathrm{F}(d_1, d_2)',
            'Z = \\frac{X - \\mu}{\\sigma}',
            'P(X = k) = \\binom{n}{k}p^{k}(1-p)^{n-k}',
            'P(X = k) = \\frac{e^{-\\lambda}\\lambda^{k}}{k!}',
            'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(x-\\mu)^{2}}{2\\sigma^{2}}}',
            '\\Phi(z)',
            '\\bar{X} \\sim \\mathrm{N}\\!\\left(\\mu, \\frac{\\sigma^{2}}{n}\\right)'
          ]
        },
        {
          titleKey: 'symSecInfer',
          items: [
            'H_0',
            'H_1',
            '\\alpha',
            '\\beta',
            'p\\text{-value}',
            '\\chi^{2} = \\sum \\frac{(O - E)^{2}}{E}',
            '\\rho',
            'r',
            'r^{2}',
            '\\hat{y} = a + bx',
            'b = \\frac{\\sum (x-\\bar{x})(y-\\bar{y})}{\\sum (x-\\bar{x})^{2}}',
            '\\mathrm{SE}',
            '\\mathrm{CI}',
            '\\mathrm{df}',
            '\\bar{d}',
            't = \\frac{\\bar{x} - \\mu}{s/\\sqrt{n}}'
          ]
        },
        {
          titleKey: 'symSecStatSymbol',
          items: [
            '\\overline{X}',
            '\\mathrm{Cov}(X,Y)',
            '\\mathrm{Corr}(X,Y)',
            '\\varepsilon',
            '\\propto',
            '\\approx',
            '\\neq',
            '\\leq',
            '\\geq',
            '\\pm',
            '\\infty',
            '\\int_{-\\infty}^{\\infty}',
            '\\sim',
            '\\therefore',
            '\\Rightarrow'
          ]
        }
      ]
    },

    /* ================================================================
       工程技术
       ================================================================ */
    {
      id: 'engineering',
      labelKey: 'symCatEngineering',
      sections: [
        {
          titleKey: 'symSecMechanics',
          items: [
            '\\sigma = \\frac{«F»}{A}',
            '\\varepsilon = \\frac{\\Delta L}{L}',
            'E = \\frac{\\sigma}{\\varepsilon}',
            '\\tau = \\frac{«V»}{A}',
            'M = Fd',
            'I = \\frac{bh^{3}}{12}',
            '\\delta = \\frac{FL^{3}}{48EI}',
            '\\theta = \\frac{TL}{GJ}',
            '\\nu = -\\frac{\\varepsilon_{lat}}{\\varepsilon_{long}}',
            '\\sum M = 0',
            '\\sum F = 0',
            '\\mathrm{FS} = \\frac{\\sigma_{y}}{\\sigma_{allow}}'
          ]
        },
        {
          titleKey: 'symSecCircuit',
          items: [
            'V = IR',
            'P = VI = I^{2}R',
            'Z = \\sqrt{R^{2} + X^{2}}',
            'X_L = \\omega L',
            'X_C = \\frac{1}{\\omega C}',
            '\\omega = 2\\pi f',
            '\\frac{1}{Z} = \\frac{1}{Z_1} + \\frac{1}{Z_2}',
            '\\phi = \\arctan\\frac{X}{R}',
            'v(t) = V_m\\sin(\\omega t)',
            'V_{rms} = \\frac{V_m}{\\sqrt{2}}',
            '\\tau = RC'
          ]
        },
        {
          titleKey: 'symSecControl',
          items: [
            '\\dot{«x»}',
            '\\ddot{«x»}',
            '\\frac{\\mathrm{d}}{\\mathrm{d}t}',
            '\\mathcal{L}',
            'H(s)',
            'G(s) = \\frac{«K»}{s(s+1)}',
            '\\zeta',
            '\\omega_n',
            'y(t)',
            '\\delta(t)',
            'u(t)',
            '\\frac{Y(s)}{U(s)}',
            '\\lim_{s \\to 0}'
          ]
        },
        {
          titleKey: 'symSecThermo',
          items: [
            '\\eta = \\frac{«W»}{Q_H}',
            'Q = mc\\Delta T',
            '\\Delta U = Q - W',
            'PV = nRT',
            '\\mathrm{COP} = \\frac{Q_C}{W}',
            '\\dot{Q}',
            '\\dot{m}',
            'q = k\\frac{\\Delta T}{L}',
            '\\mathrm{Nu} = \\frac{hL}{k}',
            '\\mathrm{Re} = \\frac{\\rho v L}{\\mu}'
          ]
        },
        {
          titleKey: 'symSecEngUnit',
          items: [
            '\\text{N}',
            '\\text{kN}',
            '\\text{Pa}',
            '\\text{kPa}',
            '\\text{MPa}',
            '\\text{GPa}',
            '\\text{N}\\cdot\\text{m}',
            '\\text{mm}',
            '\\text{cm}',
            '\\text{m}',
            '\\text{km}',
            '\\text{mm}^{2}',
            '\\text{mm}^{4}',
            '\\text{kg/m}^{3}',
            '\\text{kW}',
            '\\text{kWh}',
            '\\text{rpm}',
            '\\text{m}^{3}/\\text{s}',
            '\\text{m/s}',
            '^{\\circ}'
          ]
        },
        {
          titleKey: 'symSecGeometry',
          items: [
            '\\vec{«F»}',
            '\\vec{«r»}',
            '\\left|\\vec{«F»}\\right|',
            '\\hat{«n»}',
            '\\theta',
            '\\phi',
            '\\angle «ABC»',
            '\\perp',
            '\\parallel',
            '\\triangle «ABC»',
            '\\sin\\theta',
            '\\cos\\theta',
            '\\tan\\theta',
            '\\frac{\\mathrm{d}y}{\\mathrm{x}}'
          ]
        },
        {
          titleKey: 'symSecEngMath',
          items: [
            '\\approx',
            '\\simeq',
            '\\ll',
            '\\gg',
            '\\pm',
            '\\propto',
            '\\infty',
            '\\in',
            '\\forall',
            '\\exists',
            '\\sum_{i=1}^{n}',
            '\\prod_{i=1}^{n}',
            '\\int_{0}^{«t»}',
            '\\iint',
            '\\oint',
            '\\nabla',
            '\\begin{bmatrix} «a» & b \\\\ c & d \\end{bmatrix}'
          ]
        }
      ]
    }
  ];

  MM.symbolCatalogs = MM.symbolCatalogs || {};
  // math: true —— 插入时若不在 $...$ 里会自动补上
  MM.symbolCatalogs.math = { math: true, categories: CATEGORIES };
})();
