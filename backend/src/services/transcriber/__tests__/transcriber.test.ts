import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRecognize = vi.fn();

vi.mock('../../../config/env', () => ({
    config: {
        openai: '',
        google_creds: '',
    },
}));

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        default: {
            ...actual,
            readFileSync: vi.fn().mockReturnValue(Buffer.from('fake-audio')),
        },
    };
});

vi.mock('@google-cloud/speech', () => {
    class MockSpeechClient {
        recognize = mockRecognize;
    }
    return {
        SpeechClient: MockSpeechClient,
    };
});

import { transcribeAudio } from '../index';
import { config } from '../../../config/env';

describe('transcriber service', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
        config.google_creds = '';
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('throws error when Google Cloud credentials are not configured', async () => {
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        config.google_creds = '';
        await expect(transcribeAudio('fake-path.webm', 'google')).rejects.toThrow(
            'Google Speech transcription failed: Google Cloud credentials not configured'
        );
    });

    it('transcribes with google provider successfully using dynamic import without eval', async () => {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';

        mockRecognize.mockResolvedValueOnce([
            {
                results: [
                    {
                        alternatives: [
                            {
                                transcript: 'Hello world transcription',
                                confidence: 0.95,
                            },
                        ],
                    },
                ],
            },
        ]);

        const result = await transcribeAudio('fake-audio.webm', 'google');

        expect(result.provider).toBe('google');
        expect(result.text).toBe('Hello world transcription');
        expect(result.confidence).toBe(0.95);
        expect(mockRecognize).toHaveBeenCalledTimes(1);
    });
});
