/**
 * Database Write Queue (Mutex)
 * 
 * Ensures all database write operations are serialized (one at a time)
 * to prevent "database is locked" errors.
 * 
 * Usage:
 *   import { runDbWrite } from './dbQueue';
 *   
 *   await runDbWrite(async () => {
 *     await db.runAsync('INSERT INTO ...');
 *   });
 */

type DbWriteOperation<T> = () => Promise<T>;

interface QueuedOperation<T> {
  operation: DbWriteOperation<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
}

// Write queue - ensures only one write operation runs at a time
const writeQueue: QueuedOperation<any>[] = [];
let isProcessingWrite = false;

/**
 * Execute a database write operation in the queue
 * All writes are serialized to prevent database locking
 * 
 * @param operation - Async function that performs the write operation
 * @returns Promise that resolves with the operation result
 */
export const runDbWrite = async <T>(
  operation: DbWriteOperation<T>
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    // Add operation to queue
    writeQueue.push({ operation, resolve, reject });
    
    // Process queue if not already processing
    processWriteQueue();
  });
};

/**
 * Process the write queue - executes operations one at a time
 */
const processWriteQueue = async () => {
  // If already processing or queue is empty, return
  if (isProcessingWrite || writeQueue.length === 0) {
    return;
  }

  isProcessingWrite = true;

  try {
    while (writeQueue.length > 0) {
      const { operation, resolve, reject } = writeQueue.shift()!;

      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      }
      
      // Small delay between operations to prevent rapid-fire locking
      // This gives SQLite time to release locks between operations
      if (writeQueue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  } finally {
    isProcessingWrite = false;
    
    // If more operations were added while processing, process them
    if (writeQueue.length > 0) {
      // Use setTimeout to defer to next event loop, preventing stack overflow
      setTimeout(() => processWriteQueue(), 0);
    }
  }
};

/**
 * Get the current queue length (for debugging)
 */
export const getWriteQueueLength = (): number => {
  return writeQueue.length;
};

/**
 * Check if a write operation is currently processing
 */
export const isWriteInProgress = (): boolean => {
  return isProcessingWrite;
};

