import { memo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

type Props = {
  token: string;
  enabled: boolean;
  size?: number;
  maxWidth?: number;
};

function isWord(token: string): boolean {
  return /[\p{L}\p{N}]/u.test(token);
}

function splitWordToken(token: string) {
  const match = token.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}]+(?:[\-’'][\p{L}\p{N}]+)*)([^\p{L}\p{N}]*)$/u);
  if (!match) return null;
  return {
    leading: match[1],
    core: match[2],
    trailing: match[3],
  };
}

function getOrpIndex(word: string): number {
  const length = word.length;
  if (length <= 2) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  if (length <= 13) return 3;
  return 4;
}

function getDeterministicOrpSize(
  baseSize: number,
  maxWidth: number | undefined,
  leftLength: number,
  rightLength: number
): number {
  if (!maxWidth || maxWidth <= 0) return baseSize;
  const glyphWidthFactor = 0.62;
  const leftLimit = maxWidth / (glyphWidthFactor * (2 * leftLength + 1));
  const rightLimit = maxWidth / (glyphWidthFactor * (2 * rightLength + 1));
  const fitted = Math.floor(Math.min(baseSize, leftLimit, rightLimit));
  return Math.max(24, Math.min(baseSize, fitted));
}

const monoFont = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

function OrpWordBase({ token, enabled, size = 50, maxWidth }: Props) {
  const slotLineHeight = Math.round(size * 1.2);

  if (!enabled || !isWord(token)) {
    return (
      <View style={[styles.slot, { minHeight: slotLineHeight }]}>
        <Text style={[styles.base, { fontSize: size, lineHeight: slotLineHeight }]}>
          {token === '\n' ? '¶' : token}
        </Text>
      </View>
    );
  }

  const parts = splitWordToken(token);
  if (!parts) {
    return (
      <View style={[styles.slot, { minHeight: slotLineHeight }]}>
        <Text style={[styles.base, { fontSize: size, lineHeight: slotLineHeight }]}>{token}</Text>
      </View>
    );
  }

  const idx = Math.min(getOrpIndex(parts.core), parts.core.length - 1);
  const prefix = parts.core.slice(0, idx);
  const orpChar = parts.core[idx];
  const suffix = parts.core.slice(idx + 1);
  const leftText = `${parts.leading}${prefix}`;
  const rightText = `${suffix}${parts.trailing}`;
  const effectiveSize = getDeterministicOrpSize(size, maxWidth, leftText.length, rightText.length);

  return (
    <View style={[styles.slot, { minHeight: slotLineHeight }]}>
      <View style={styles.row}>
        <Text
          numberOfLines={1}
          style={[styles.base, styles.mono, styles.side, styles.left, { fontSize: effectiveSize, lineHeight: slotLineHeight }]}>
          {leftText}
        </Text>
        <Text style={[styles.base, styles.mono, styles.orp, { fontSize: effectiveSize, lineHeight: slotLineHeight }]}>
          {orpChar}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.base, styles.mono, styles.side, styles.right, { fontSize: effectiveSize, lineHeight: slotLineHeight }]}>
          {rightText}
        </Text>
      </View>
    </View>
  );
}

export const OrpWord = memo(OrpWordBase);

const styles = StyleSheet.create({
  base: {
    color: '#F2F6FA',
    textAlign: 'center',
    fontWeight: '500',
  },
  mono: {
    fontFamily: monoFont,
  },
  row: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  slot: {
    width: '100%',
    justifyContent: 'center',
  },
  side: {
    flex: 1,
    minWidth: 0,
  },
  left: {
    textAlign: 'right',
    paddingRight: 2,
  },
  right: {
    textAlign: 'left',
    paddingLeft: 2,
  },
  orp: {
    color: '#FF735C',
    fontWeight: '800',
  },
});
