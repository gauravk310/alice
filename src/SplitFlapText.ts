// SplitFlapText.ts — Vanilla TypeScript port of SplitFlapText
// Flip-disc departure board style animated text component

export type SplitFlapAlign = 'left' | 'center' | 'right';
export type SplitFlapOrder = 'left' | 'right' | 'center' | 'random';
export type SplitFlapTileStyle = 'board' | 'minimal';

export interface SplitFlapTextOptions {
  words?: string[];
  text?: string;
  flipDuration?: number;
  stagger?: number;
  cycleDelay?: number;
  charset?: 'alpha' | 'alphanumeric' | 'numeric' | string;
  flipsPerChar?: number;
  tileColor?: string;
  textColor?: string;
  tileRadius?: number | string;
  gap?: number | string;
  fontSize?: number | string;
  loop?: boolean;
  padTo?: number;
  align?: SplitFlapAlign;
  intro?: boolean;
  glare?: number;
  depth?: number;
  order?: SplitFlapOrder;
  tileStyle?: SplitFlapTileStyle;
  className?: string;
  hideSpaceTiles?: boolean;
  spaceWidth?: number | string;
}

type TileState = {
  current: string;
  next: string;
  flipping: boolean;
  tick: number;
};

type AnimationPlan = {
  index: number;
  from: string;
  target: string;
  sequence: string[];
  start: number;
  step: number;
  done: boolean;
};

type TileUpdate = {
  index: number;
  current: string;
  next: string;
  done: boolean;
};

const DEFAULT_WORDS = ['KING OF HEARTS'];

const CHARSETS: Record<string, string> = {
  alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  numeric: '0123456789'
};

const toCssUnit = (value: number | string) => (typeof value === 'number' ? `${value}px` : value);

const resolveCharset = (charset?: string) => {
  if (charset && CHARSETS[charset]) return CHARSETS[charset];
  return typeof charset === 'string' && charset.length > 0 ? charset : CHARSETS.alphanumeric;
};

const normalizePhrase = (phrase: string, width: number, align: SplitFlapAlign = 'left') => {
  const safe = String(phrase ?? '').slice(0, width);
  if (align === 'right') return safe.padStart(width, ' ');
  if (align === 'center') {
    return safe.padStart(safe.length + Math.floor((width - safe.length) / 2), ' ').padEnd(width, ' ');
  }
  return safe.padEnd(width, ' ');
};

const sampleChar = (charset: string) => charset.charAt(Math.floor(Math.random() * charset.length)) || ' ';

const buildSequence = (target: string, flips: number, charset: string) => {
  const steps: string[] = [];
  for (let i = 0; i < flips; i += 1) {
    steps.push(sampleChar(charset));
  }
  steps.push(target);
  return steps;
};

const toGlyph = (char: string) => (char === ' ' ? '\u00A0' : char);

const shuffleIndices = (count: number) => {
  const list = Array.from({ length: count }, (_, index) => index);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

const cascadeStep = (index: number, width: number, order: SplitFlapOrder, randomOrder: number[] | null) => {
  if (order === 'right') return width - 1 - index;
  if (order === 'center') return Math.floor(Math.abs(index - (width - 1) / 2));
  if (order === 'random' && randomOrder) return randomOrder[index];
  return index;
};

const clampUnit = (value: number) => Math.min(1, Math.max(0, Number(value) || 0));

const round = (value: number) => Number(value.toFixed(3));

/**
 * Mount and run SplitFlapText on a container element.
 * Returns a cleanup function.
 */
export function initSplitFlapText(
  container: HTMLElement,
  options: SplitFlapTextOptions = {}
): () => void {
  const {
    words = DEFAULT_WORDS,
    text,
    flipDuration = 0.12,
    stagger = 0.06,
    cycleDelay = 2400,
    charset = 'alphanumeric',
    flipsPerChar = 8,
    tileColor = '#111827',
    textColor = '#f8fafc',
    tileRadius = 8,
    gap = 6,
    fontSize = 52,
    loop = true,
    padTo = 14,
    align = 'left',
    intro = true,
    glare = 0,
    depth = 0.5,
    order = 'left',
    tileStyle = 'board',
    className = '',
    hideSpaceTiles = true,
    spaceWidth = '0.35em'
  } = options;

  const prefersReducedMotion =
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  const sourceWords = Array.isArray(words) && words.length > 0 ? words : DEFAULT_WORDS;
  const phrases = typeof text === 'string' ? [text] : sourceWords.map(w => String(w ?? ''));

  const longest = phrases.reduce((max, phrase) => Math.max(max, phrase.length), 1);
  const width = Math.max(1, Math.ceil(Number(padTo) || 0), longest);

  const normalizedPhrases = phrases.map(phrase => normalizePhrase(phrase, width, align));

  const flipMs = Math.max(40, (Number(flipDuration) || 0.12) * 1000);
  const staggerMs = Math.max(0, (Number(stagger) || 0) * 1000);
  const holdMs = Math.max(400, Number(cycleDelay) || 2400);
  const flips = Math.max(0, Math.floor(Number(flipsPerChar) || 0));
  const glyphs = resolveCharset(charset);

  const minimal = tileStyle === 'minimal';
  const level = clampUnit(depth);
  const flat = Math.min(1, level * 2);
  const deep = Math.max(0, level - 0.5) * 2;
  const sheen = minimal ? 0 : clampUnit(glare);
  const shaded = !minimal && deep > 0;

  // Build root container
  const root = document.createElement('div');
  const rootClasses = [
    'split-flap-text',
    minimal && 'split-flap-text--minimal',
    sheen > 0 && 'split-flap-text--glare',
    'relative inline-flex items-center whitespace-pre select-none',
    className
  ].filter(Boolean) as string[];

  root.className = rootClasses.join(' ');

  // Set CSS Variables
  root.style.setProperty('--split-flap-tile-color', tileColor);
  root.style.setProperty('--split-flap-text-color', textColor);
  root.style.setProperty('--split-flap-radius', toCssUnit(tileRadius));
  root.style.setProperty('--split-flap-gap', toCssUnit(gap));
  root.style.setProperty('--split-flap-font-size', toCssUnit(fontSize));
  root.style.setProperty('--split-flap-flip-duration', `${Math.max(0.04, Number(flipDuration) || 0.12)}s`);
  root.style.setProperty('--split-flap-front-from', `${round(1 + 0.08 * flat)}`);
  root.style.setProperty('--split-flap-front-to', `${round(1 - 0.48 * flat - 0.3 * deep)}`);
  root.style.setProperty('--split-flap-back-from', `${round(1 - 0.42 * flat - 0.3 * deep)}`);
  root.style.setProperty('--split-flap-hinge', `calc(1px + ${round(deep * 0.05)}em)`);
  root.style.setProperty('--split-flap-hinge-shade', `${round(0.25 + 0.39 * flat + 0.21 * deep)}`);
  root.style.setProperty('--split-flap-drop', `${round(0.28 * flat + 0.2 * deep)}`);
  root.style.setProperty('--split-flap-lift', `${round(0.4 + 0.6 * flat + 0.7 * deep)}`);
  root.style.setProperty('--split-flap-cast', `${round(deep * 0.62)}`);
  root.style.setProperty('--split-flap-edge', `${round(deep * 0.035)}em`);
  root.style.setProperty('--split-flap-split', `${round(0.015 + level * 0.06)}em`);
  root.style.setProperty('--split-flap-glare', `${round(sheen * 0.55)}`);
  root.style.setProperty('--split-flap-space-width', toCssUnit(spaceWidth));

  // Screen reader label (visually hidden, takes no layout space)
  const srLabel = document.createElement('span');
  srLabel.className = 'sr-only';
  srLabel.style.cssText =
    'position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important;';
  srLabel.textContent = phrases[0] || '';
  root.appendChild(srLabel);

  // Initialize tile DOM elements and states
  const initialPhrase = intro ? ' '.repeat(width) : normalizedPhrases[0];
  const tileStates: TileState[] = initialPhrase.split('').map(char => ({
    current: char,
    next: char,
    flipping: false,
    tick: 0
  }));

  const tileElements: HTMLElement[] = [];
  const topCharElements: HTMLElement[] = [];
  const bottomCharElements: HTMLElement[] = [];
  const dynamicFlapContainers: HTMLElement[] = [];

  for (let i = 0; i < width; i++) {
    const tile = document.createElement('span');
    tile.className = 'split-flap-text__tile';
    if (hideSpaceTiles && tileStates[i].current === ' ') {
      tile.classList.add('is-space');
    }
    tile.setAttribute('aria-hidden', 'true');

    // Top half
    const topHalf = document.createElement('span');
    topHalf.className = 'split-flap-text__half split-flap-text__half--top';
    const topChar = document.createElement('span');
    topChar.className = 'split-flap-text__char';
    topChar.textContent = toGlyph(tileStates[i].current);
    topHalf.appendChild(topChar);
    tile.appendChild(topHalf);
    topCharElements.push(topChar);

    // Bottom half
    const bottomHalf = document.createElement('span');
    bottomHalf.className = 'split-flap-text__half split-flap-text__half--bottom';
    const bottomChar = document.createElement('span');
    bottomChar.className = 'split-flap-text__char';
    bottomChar.textContent = toGlyph(tileStates[i].current);
    bottomHalf.appendChild(bottomChar);
    tile.appendChild(bottomHalf);
    bottomCharElements.push(bottomChar);

    // Flap dynamic sub-container
    const flapContainer = document.createElement('span');
    flapContainer.className = 'split-flap-text__flap-host';
    tile.appendChild(flapContainer);
    dynamicFlapContainers.push(flapContainer);

    tileElements.push(tile);
    root.appendChild(tile);
  }

  container.innerHTML = '';
  container.appendChild(root);

  // Animation controller
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rafId: number | null = null;
  let shownPhrase: string | null = intro ? ' '.repeat(width) : normalizedPhrases[0];
  let activePhraseIndex = 0;

  const updateTileDOM = (index: number, current: string, next: string, flipping: boolean) => {
    const tile = tileElements[index];
    const topChar = topCharElements[index];
    const bottomChar = bottomCharElements[index];
    const flapHost = dynamicFlapContainers[index];
    if (!tile || !topChar || !bottomChar || !flapHost) return;

    if (flipping) {
      if (hideSpaceTiles) tile.classList.remove('is-space');
      tile.classList.add('is-flipping');
      topChar.textContent = toGlyph(next);
      bottomChar.textContent = toGlyph(current);

      let inner = '';
      if (shaded) {
        inner += `
          <span class="split-flap-text__shade split-flap-text__shade--top"></span>
          <span class="split-flap-text__shade split-flap-text__shade--bottom"></span>
        `;
      }
      inner += `
        <span class="split-flap-text__flap split-flap-text__flap--front">
          <span class="split-flap-text__char">${toGlyph(current)}</span>
        </span>
        <span class="split-flap-text__flap split-flap-text__flap--back">
          <span class="split-flap-text__char">${toGlyph(next)}</span>
        </span>
      `;
      flapHost.innerHTML = inner;
    } else {
      tile.classList.remove('is-flipping');
      topChar.textContent = toGlyph(current);
      bottomChar.textContent = toGlyph(current);
      flapHost.innerHTML = '';
      if (hideSpaceTiles && current === ' ') {
        tile.classList.add('is-space');
      } else if (hideSpaceTiles) {
        tile.classList.remove('is-space');
      }
    }
  };

  const stopFrame = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  };

  const animateTo = (target: string) => {
    const from = normalizePhrase(shownPhrase ?? target, target.length);
    const randomOrder = order === 'random' ? shuffleIndices(target.length) : null;

    stopFrame();
    shownPhrase = target;

    const plans: AnimationPlan[] = [];
    if (!prefersReducedMotion) {
      for (let index = 0; index < target.length; index += 1) {
        if (from[index] === target[index]) continue;
        plans.push({
          index,
          from: from[index],
          target: target[index],
          sequence: buildSequence(target[index], flips, glyphs),
          start: cascadeStep(index, target.length, order, randomOrder) * staggerMs,
          step: -1,
          done: false
        });
      }
    }

    if (!plans.length) {
      for (let i = 0; i < target.length; i++) {
        updateTileDOM(i, target[i], target[i], false);
      }
      return 0;
    }

    for (let i = 0; i < from.length; i++) {
      updateTileDOM(i, from[i], from[i], false);
    }

    const totalDuration = plans.reduce((max, plan) => Math.max(max, plan.start + plan.sequence.length * flipMs), 0);
    const startedAt = performance.now();

    const tick = (now: number) => {
      if (cancelled) return;

      const elapsed = now - startedAt;
      const updates: TileUpdate[] = [];
      let running = false;

      plans.forEach(plan => {
        const localElapsed = elapsed - plan.start;

        if (localElapsed < 0) {
          running = true;
          return;
        }

        const step = Math.floor(localElapsed / flipMs);

        if (step < plan.sequence.length) {
          running = true;

          if (step !== plan.step) {
            plan.step = step;
            updates.push({
              index: plan.index,
              current: step === 0 ? plan.from : plan.sequence[step - 1],
              next: plan.sequence[step],
              done: false
            });
          }
        } else if (!plan.done) {
          plan.done = true;
          updates.push({
            index: plan.index,
            current: plan.target,
            next: plan.target,
            done: true
          });
        }
      });

      if (updates.length > 0) {
        updates.forEach(update => {
          updateTileDOM(update.index, update.current, update.next, !update.done);
        });
      }

      if (running) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    };

    rafId = requestAnimationFrame(tick);
    return totalDuration;
  };

  const show = (index: number) => {
    activePhraseIndex = index;
    srLabel.textContent = phrases[index] || '';
    return animateTo(normalizedPhrases[index]);
  };

  const scheduleNext = (delay: number) => {
    timer = setTimeout(() => {
      if (cancelled) return;

      if (document.hidden) {
        scheduleNext(holdMs);
        return;
      }

      const nextIndex = activePhraseIndex + 1;
      if (nextIndex >= normalizedPhrases.length && !loop) return;

      const duration = show(nextIndex % normalizedPhrases.length);
      scheduleNext(holdMs + duration);
    }, delay);
  };

  let startDuration = 0;
  if (shownPhrase === normalizedPhrases[0] && !intro) {
    for (let i = 0; i < normalizedPhrases[0].length; i++) {
      updateTileDOM(i, normalizedPhrases[0][i], normalizedPhrases[0][i], false);
    }
  } else {
    startDuration = show(0);
  }

  if (normalizedPhrases.length > 1) {
    scheduleNext(holdMs + startDuration);
  }

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    stopFrame();
  };
}

export default initSplitFlapText;

