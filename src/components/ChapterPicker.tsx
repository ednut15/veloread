import React, { useCallback } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChapterMeta } from '@/src/types';

type Props = {
  visible: boolean;
  chapters: ChapterMeta[];
  currentChapterIndex: number;
  onSelect: (chapterIndex: number) => void;
  onClose: () => void;
};

const ROW_HEIGHT = 56;

export function ChapterPicker({ visible, chapters, currentChapterIndex, onSelect, onClose }: Props) {
  const renderItem = useCallback(
    ({ item, index }: { item: ChapterMeta; index: number }) => {
      const isCurrent = index === currentChapterIndex;
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Go to chapter ${index + 1}: ${item.title}`}
          accessibilityState={{ selected: isCurrent }}
          style={[styles.row, isCurrent && styles.rowCurrent]}
          onPress={() => onSelect(index)}>
          <Text style={[styles.rowIndex, isCurrent && styles.rowTextCurrent]}>{index + 1}</Text>
          <Text numberOfLines={1} style={[styles.rowTitle, isCurrent && styles.rowTextCurrent]}>
            {item.title}
          </Text>
        </Pressable>
      );
    },
    [currentChapterIndex, onSelect]
  );

  const initialScrollIndex = chapters.length
    ? Math.max(0, Math.min(currentChapterIndex, chapters.length - 1))
    : 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close chapter list"
          style={styles.backdropTouchable}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Chapters</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.closeButton}
              onPress={onClose}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <FlatList
            data={chapters}
            keyExtractor={(item, index) => `${index}-${item.startToken}`}
            renderItem={renderItem}
            getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
            initialScrollIndex={initialScrollIndex}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(4, 8, 14, 0.72)',
  },
  backdropTouchable: {
    flex: 1,
  },
  sheet: {
    maxHeight: '70%',
    backgroundColor: '#101827',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: '#1b2535',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1b2535',
  },
  title: {
    color: '#f5f7ff',
    fontSize: 18,
    fontWeight: '800',
  },
  closeButton: {
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
    backgroundColor: '#2a364c',
  },
  closeText: {
    color: '#f5f7ff',
    fontWeight: '700',
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
  },
  rowCurrent: {
    backgroundColor: '#1c2c47',
  },
  rowIndex: {
    width: 28,
    color: '#9fb1ce',
    fontWeight: '700',
    textAlign: 'right',
  },
  rowTitle: {
    flex: 1,
    color: '#f5f7ff',
    fontSize: 15,
    fontWeight: '600',
  },
  rowTextCurrent: {
    color: '#5cc8ff',
  },
});
