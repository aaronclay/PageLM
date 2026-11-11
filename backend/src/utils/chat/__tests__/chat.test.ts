import { describe, it, expect, vi, beforeEach } from 'vitest';
import db from '../../database/keyv';
import { listChats, ChatMeta } from '../chat';

vi.mock('../../database/keyv', () => {
  return {
    default: {
      get: vi.fn(),
      getMany: vi.fn(),
      set: vi.fn(),
    },
  };
});

describe('listChats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when index is empty', async () => {
    vi.mocked(db.get).mockResolvedValueOnce([] as any);

    const result = await listChats();

    expect(result).toEqual([]);
    expect(db.get).toHaveBeenCalledWith('chat:index');
    expect(db.getMany).not.toHaveBeenCalled();
  });

  it('returns empty array when index is undefined/null', async () => {
    vi.mocked(db.get).mockResolvedValueOnce(null as any);

    const result = await listChats();

    expect(result).toEqual([]);
    expect(db.get).toHaveBeenCalledWith('chat:index');
    expect(db.getMany).not.toHaveBeenCalled();
  });

  it('batches lookups with db.getMany and sorts by timestamp descending', async () => {
    vi.mocked(db.get).mockResolvedValueOnce(['id-1', 'id-2', 'id-3'] as any);
    const mockChats: (ChatMeta | undefined)[] = [
      { id: 'id-1', title: 'Old chat', at: 100 },
      { id: 'id-2', title: 'New chat', at: 300 },
      { id: 'id-3', title: 'Mid chat', at: 200 },
    ];
    vi.mocked(db.getMany).mockResolvedValueOnce(mockChats as any);

    const result = await listChats();

    expect(db.getMany).toHaveBeenCalledWith(['chat:id-1', 'chat:id-2', 'chat:id-3']);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('id-2');
    expect(result[1].id).toBe('id-3');
    expect(result[2].id).toBe('id-1');
  });

  it('filters out undefined or missing chats and respects limit n', async () => {
    vi.mocked(db.get).mockResolvedValueOnce(['id-1', 'id-2', 'id-3', 'id-4'] as any);
    const mockChats: (ChatMeta | undefined)[] = [
      { id: 'id-1', title: 'Chat 1', at: 50 },
      undefined,
    ];
    vi.mocked(db.getMany).mockResolvedValueOnce(mockChats as any);

    const result = await listChats(2);

    expect(db.getMany).toHaveBeenCalledWith(['chat:id-1', 'chat:id-2']);
    expect(result).toEqual([{ id: 'id-1', title: 'Chat 1', at: 50 }]);
  });
});
