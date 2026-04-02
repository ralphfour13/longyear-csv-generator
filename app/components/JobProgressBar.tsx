import { useEffect, useRef, useState } from 'react';

interface JobProgress {
  phase?: 'fetching' | 'reconciling' | 'cogs' | 'generating' | 'validating';
  phaseLabel?: string;
  overallPercentage?: number;
  currentActivity?: string;
  ordersFound?: number;
  ordersProcessed?: number;
  transactionsFetched?: number;
  filesGenerated?: number;
  filesTotalCount?: number;
  estimatedSecondsRemaining?: number;
}

interface Job {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  startDate: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  progress?: JobProgress;
  result?: {
    success: boolean;
    message: string;
    files: Array<{ filename: string; size: number }>;
    entryCount: number;
    balanced: boolean;
  };
}

interface JobProgressBarProps {
  jobId: string;
  onComplete?: (job: Job) => void;
  onError?: (error: string) => void;
}

export function JobProgressBar({ jobId, onComplete, onError }: JobProgressBarProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [elapsed, setElapsed] = useState('');

  // Use refs for callbacks to avoid re-creating the polling effect on every render
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;

  // Live duration timer for processing jobs (ticks every second)
  const jobStartedAt = job?.startedAt;
  const jobStatus = job?.status;
  useEffect(() => {
    if (jobStatus !== 'processing' || !jobStartedAt) {
      setElapsed('');
      return;
    }

    function updateElapsed() {
      const start = new Date(jobStartedAt!).getTime();
      const durationMs = Date.now() - start;
      setElapsed(formatDuration(Math.floor(durationMs / 1000)));
    }

    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [jobStatus, jobStartedAt]);

  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;

    async function fetchProgress() {
      try {
        const response = await fetch(`/api/job-progress/${jobId}`);

        if (!response.ok) {
          throw new Error(`Failed to fetch job progress: ${response.statusText}`);
        }

        const data = await response.json();
        setJob(data);

        // Stop polling if job is complete or failed
        if (data.status === 'completed' || data.status === 'failed') {
          setIsPolling(false);
          if (pollInterval) {
            clearInterval(pollInterval);
          }

          if (data.status === 'completed' && onCompleteRef.current) {
            onCompleteRef.current(data);
          } else if (data.status === 'failed' && onErrorRef.current) {
            onErrorRef.current(data.error || 'Job failed');
          }
        }
      } catch (error) {
        console.error('Error fetching job progress:', error);
        if (onErrorRef.current) {
          onErrorRef.current(error instanceof Error ? error.message : String(error));
        }
        setIsPolling(false);
        if (pollInterval) {
          clearInterval(pollInterval);
        }
      }
    }

    // Initial fetch
    fetchProgress();

    // Poll every 30 seconds while job is processing
    if (isPolling) {
      pollInterval = setInterval(fetchProgress, 30000);
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [jobId, isPolling]);

  if (!job) {
    return (
      <s-section>
        <div style={{ padding: '20px', textAlign: 'center', color: '#6D7175' }}>
          Loading job status...
        </div>
      </s-section>
    );
  }

  // Pending status
  if (job.status === 'pending') {
    return (
      <s-banner tone="info">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '16px' }}>Export for {job.startDate}</strong>
            <span style={{
              padding: '4px 12px',
              borderRadius: '12px',
              backgroundColor: '#FFF4E5',
              color: '#916A00',
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
            }}>
              Pending
            </span>
          </div>
          <div style={{ color: '#6D7175', fontSize: '14px' }}>
            Queued and waiting to be processed...
          </div>
        </div>
      </s-banner>
    );
  }

  // Completed status
  if (job.status === 'completed') {
    return (
      <s-banner tone="success">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '16px' }}>Export Complete</strong>
            <span style={{
              padding: '4px 12px',
              borderRadius: '12px',
              backgroundColor: '#E3F5ED',
              color: '#008060',
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
            }}>
              Completed
            </span>
          </div>
          {job.result && (
            <>
              <div style={{ fontSize: '14px' }}>{job.result.message}</div>
              <div style={{ color: '#6D7175', fontSize: '14px' }}>
                {job.result.entryCount} journal entries • {job.result.files.length} files generated
              </div>
              <div>
                {job.result.balanced ? (
                  <span style={{
                    padding: '4px 12px',
                    borderRadius: '12px',
                    backgroundColor: '#E3F5ED',
                    color: '#008060',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}>
                    ✓ Balanced
                  </span>
                ) : (
                  <span style={{
                    padding: '4px 12px',
                    borderRadius: '12px',
                    backgroundColor: '#FFF4E5',
                    color: '#916A00',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}>
                    ⚠ Not Balanced
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </s-banner>
    );
  }

  // Failed status
  if (job.status === 'failed') {
    return (
      <s-banner tone="critical">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '16px' }}>Export Failed</strong>
            <span style={{
              padding: '4px 12px',
              borderRadius: '12px',
              backgroundColor: '#FFEAE8',
              color: '#D72C0D',
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
            }}>
              Failed
            </span>
          </div>
          <div style={{ fontSize: '14px', color: '#D72C0D' }}>
            {job.error || 'An unknown error occurred'}
          </div>
        </div>
      </s-banner>
    );
  }

  // Processing status with progress
  const progress = job.progress;
  const percentage = progress?.overallPercentage || 0;

  return (
    <s-section>
      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: '16px' }}>Export for {job.startDate}</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {elapsed && (
              <span style={{ fontSize: '13px', color: '#6D7175', fontVariantNumeric: 'tabular-nums' }}>
                {elapsed}
              </span>
            )}
            <span style={{
              padding: '4px 12px',
              borderRadius: '12px',
              backgroundColor: '#E3F2FD',
              color: '#0D5EAF',
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
            }}>
              Processing
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{
          width: '100%',
          height: '8px',
          backgroundColor: '#E1E3E5',
          borderRadius: '4px',
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${percentage}%`,
            height: '100%',
            backgroundColor: '#008060',
            transition: 'width 0.3s ease',
          }} />
        </div>

        {/* Phase and percentage */}
        {progress && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#202223' }}>
              {progress.phaseLabel || 'Processing...'}
            </span>
            <span style={{ fontSize: '14px', color: '#6D7175' }}>
              {percentage}%
            </span>
          </div>
        )}

        {/* Current activity */}
        {progress?.currentActivity && (
          <div style={{ fontSize: '14px', color: '#6D7175' }}>
            {progress.currentActivity}
          </div>
        )}

        {/* Phase-specific metrics */}
        {progress && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {progress.phase === 'fetching' && progress.ordersFound && (
              <div style={{ fontSize: '13px', color: '#6D7175' }}>
                Fetched {progress.transactionsFetched || 0} / {progress.ordersFound} orders
              </div>
            )}

            {progress.phase === 'reconciling' && progress.ordersProcessed && (
              <div style={{ fontSize: '13px', color: '#6D7175' }}>
                Matched {progress.ordersProcessed} orders with captures
              </div>
            )}

            {progress.phase === 'generating' && progress.filesTotalCount && (
              <div style={{ fontSize: '13px', color: '#6D7175' }}>
                Generated {progress.filesGenerated || 0} / {progress.filesTotalCount} files
              </div>
            )}

            {/* Time remaining */}
            {progress.estimatedSecondsRemaining !== undefined && progress.estimatedSecondsRemaining > 0 && (
              <div style={{ fontSize: '13px', color: '#6D7175' }}>
                Est. {formatDuration(progress.estimatedSecondsRemaining)} remaining
              </div>
            )}
          </div>
        )}
      </div>
    </s-section>
  );
}

/**
 * Format seconds into human-readable duration
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (minutes < 60) {
    return `${minutes}m ${secs}s`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}
