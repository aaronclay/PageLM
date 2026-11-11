import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../config/env', () => ({
    config: {
        openai: 'mock-openai-key',
        google_creds: '',
        eleven_api_key: '',
        transcription_provider: 'assemblyai',
        assemblyai_api_key: '',
    },
}));

import fs from 'fs';
import { transcribeAudio } from '../index';

describe('transcribeAudio with AssemblyAI', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
    });

    it('throws error if ASSEMBLYAI_API_KEY is not configured', async () => {
        delete process.env.ASSEMBLYAI_API_KEY;
        await expect(transcribeAudio('dummy.mp3', 'assemblyai')).rejects.toThrow(
            'AssemblyAI API key not configured'
        );
    });

    it('uses fs.promises.readFile asynchronously to read the file and performs transcription', async () => {
        process.env.ASSEMBLYAI_API_KEY = 'test-assemblyai-key';

        const mockAudioBuffer = Buffer.from('mock audio file content');
        const readFileSpy = vi.spyOn(fs.promises, 'readFile').mockResolvedValue(mockAudioBuffer);
        const syncReadSpy = vi.spyOn(fs, 'readFileSync');

        const mockFetch = vi.fn();
        globalThis.fetch = mockFetch as any;

        // Mock upload endpoint
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ upload_url: 'https://assemblyai-storage/file.mp3' }),
        });

        // Mock transcript create endpoint
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'mock-transcript-id' }),
        });

        // Mock transcript polling endpoint
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                status: 'completed',
                text: 'Hello world from AssemblyAI test transcript',
                confidence: 0.98,
            }),
        });

        const result = await transcribeAudio('test/path/sample.mp3', 'assemblyai');

        expect(readFileSpy).toHaveBeenCalledWith('test/path/sample.mp3');
        expect(syncReadSpy).not.toHaveBeenCalled();

        expect(mockFetch).toHaveBeenNthCalledWith(
            1,
            'https://api.assemblyai.com/v2/upload',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    Authorization: 'Bearer test-assemblyai-key',
                    'Content-Type': 'application/octet-stream',
                },
                body: mockAudioBuffer,
            })
        );

        expect(mockFetch).toHaveBeenNthCalledWith(
            2,
            'https://api.assemblyai.com/v2/transcript',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    audio_url: 'https://assemblyai-storage/file.mp3',
                    punctuate: true,
                    format_text: true,
                }),
            })
        );

        expect(result.provider).toBe('assemblyai');
        expect(result.text).toBe('Hello world from AssemblyAI test transcript');
        expect(result.confidence).toBe(0.98);
    });

    it('handles AssemblyAI transcription status error', async () => {
        process.env.ASSEMBLYAI_API_KEY = 'test-assemblyai-key';

        const mockAudioBuffer = Buffer.from('mock audio file content');
        vi.spyOn(fs.promises, 'readFile').mockResolvedValue(mockAudioBuffer);

        const mockFetch = vi.fn();
        globalThis.fetch = mockFetch as any;

        // Mock upload endpoint
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ upload_url: 'https://assemblyai-storage/file.mp3' }),
        });

        // Mock transcript create endpoint
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'mock-transcript-id' }),
        });

        // Mock transcript polling endpoint returning error
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                status: 'error',
                error: 'Corrupt audio file',
            }),
        });

        await expect(transcribeAudio('test/path/sample.mp3', 'assemblyai')).rejects.toThrow(
            'AssemblyAI transcription failed: Corrupt audio file'
        );
    });
});
