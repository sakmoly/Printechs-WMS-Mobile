import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return '#FFA500';
      case 'unloaded':
        return '#4CAF50';
      case 'receiving':
      case 'inreceiving': // Backward compatibility with old data
        return '#2196F3';
      case 'received':
        return '#9C27B0';
      case 'open':
        return '#4CAF50';
      case 'closed':
        return '#757575';
      case 'sealed':
        return '#FF9800';
      case 'dispatched':
        return '#4CAF50';
      default:
        return '#757575';
    }
  };

  // Normalize status display text (for backward compatibility with old "InReceiving" data)
  const getDisplayStatus = (status: string): string => {
    const normalized = status.toLowerCase();
    if (normalized === 'inreceiving') {
      return 'Receiving';
    }
    return status; // Return original status for all other cases
  };

  return (
    <View style={[styles.badge, { backgroundColor: getStatusColor(status) }]}>
      <Text style={styles.text}>{getDisplayStatus(status)}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});

