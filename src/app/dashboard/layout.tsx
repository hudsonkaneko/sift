'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import TaskList from '@/components/tasks/TaskList';
import CalendarView from '@/components/calendar/CalendarView';
import CalendarSourcesSidebar from '@/components/calendar/CalendarSourcesSidebar';
import SettingsPanel from '@/components/settings/SettingsPanel';
import PullUpToast from '@/components/ui/PullUpToast';
import { useTasks } from '@/hooks/useTasks';
import { usePreferences } from '@/hooks/usePreferences';
import { useFixedBlocks } from '@/hooks/useFixedBlocks';
import { useSchedule } from '@/hooks/useSchedule';
import { useChat } from '@/hooks/useChat';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';
import { useCalendarSources } from '@/hooks/useCalendarSources';
import { SNAP_MINUTES, snapMinutes } from '@/components/calendar/constants';
import { DEFAULT_PREFERENCES } from '@/lib/types/domain';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const { tasks, toggleComplete, updateTask, deleteTask, addSubtask, deleteAllTasks, mutate: mutateTasks } = useTasks();
  const { preferences, updatePreferences } = usePreferences();
  const {
    weekOf,
    slots,
    isCurrentWeek,
    generating,
    navigateWeek,
    goToToday,
    updateSlot,
    deleteSlot,
    mergeMove,
    generateSchedule,
    mutateSlots,
  } = useSchedule();
  const { fixedBlocks, addFixedBlock, updateFixedBlock, deleteFixedBlock, mutate: mutateBlocks } = useFixedBlocks(weekOf);
  const gcal = useGoogleCalendar();
  const { sources, visibility, toggleFixedBlocks, toggleGoogleCalendar, toggleScheduling, isGoogleCalendarVisible, mutateSources } = useCalendarSources(gcal.hasAccounts);
  const {
    sessions,
    activeSessionId,
    messages,
    loading: chatLoading,
    projectScope,
    switchSession,
    createSession,
    renameSession,
    deleteSession,
    sendMessage,
    clearMessages,
    fetchMessages,
    createProjectChat,
    enterProjectScope,
    exitProjectScope,
  } = useChat();

  // Pull-up toast state
  interface PullUpToastData {
    slotId: string;
    taskName: string;
    currentStartHour: number;
    currentStartMinute: number;
    endHour: number;
    endMinute: number;
  }
  const [pullUpToast, setPullUpToast] = useState<PullUpToastData | null>(null);

  // Wrap toggleComplete to detect pull-up opportunities
  const handleToggleComplete = useCallback(async (taskId: string, completed: boolean) => {
    // Optimistically lock/unlock slots for this task
    const updatedSlots = (slots || []).map(s =>
      s.taskId === taskId ? { ...s, locked: completed } : s
    );
    mutateSlots(updatedSlots, false);

    await toggleComplete(taskId, completed);
    mutateSlots(); // revalidate to get server state

    if (!completed || !isCurrentWeek) return;

    const todayDow = new Date().getDay();
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    // Find slots for the completed task today
    const completedSlots = (slots || []).filter(
      s => s.taskId === taskId && s.dayOfWeek === todayDow
    );
    if (completedSlots.length === 0) return;

    // Take the one ending latest
    const latestEnd = completedSlots.reduce((best, s) => {
      const endMin = s.endHour * 60 + s.endMinute;
      const bestEnd = best.endHour * 60 + best.endMinute;
      return endMin > bestEnd ? s : best;
    });

    const completedEndMin = latestEnd.endHour * 60 + latestEnd.endMinute;

    // Find next incomplete slot on same day, starting after the completed slot ends
    const candidates = (slots || []).filter(s => {
      if (s.dayOfWeek !== todayDow) return false;
      if (s.taskId === taskId) return false; // exclude same-task split slots
      const startMin = s.startHour * 60 + s.startMinute;
      if (startMin <= completedEndMin) return false;
      if (s.task?.completed) return false;
      return true;
    });

    if (candidates.length === 0) return;

    // Pick the earliest candidate
    const nextSlot = candidates.reduce((best, s) => {
      const startMin = s.startHour * 60 + s.startMinute;
      const bestStart = best.startHour * 60 + best.startMinute;
      return startMin < bestStart ? s : best;
    });

    // Don't offer pull-up if next slot starts within 15min of now
    const nextStartMin = nextSlot.startHour * 60 + nextSlot.startMinute;
    if (nextStartMin - nowMinutes < SNAP_MINUTES) return;

    setPullUpToast({
      slotId: nextSlot.id,
      taskName: nextSlot.task?.name || 'Next task',
      currentStartHour: nextSlot.startHour,
      currentStartMinute: nextSlot.startMinute,
      endHour: nextSlot.endHour,
      endMinute: nextSlot.endMinute,
    });
  }, [toggleComplete, isCurrentWeek, slots]);

  // Handle pull-up action
  const handlePullUp = useCallback(() => {
    if (!pullUpToast) return;

    const now = new Date();
    const nowTotal = now.getHours() * 60 + now.getMinutes();
    const snappedStart = snapMinutes(nowTotal);

    const duration =
      (pullUpToast.endHour * 60 + pullUpToast.endMinute) -
      (pullUpToast.currentStartHour * 60 + pullUpToast.currentStartMinute);

    let newEndTotal = snappedStart + duration;
    if (newEndTotal > 24 * 60) newEndTotal = 24 * 60; // clamp to midnight

    updateSlot(pullUpToast.slotId, {
      startHour: Math.floor(snappedStart / 60),
      startMinute: snappedStart % 60,
      endHour: Math.floor(newEndTotal / 60),
      endMinute: newEndTotal % 60,
    });

    setPullUpToast(null);
  }, [pullUpToast, updateSlot]);

  // Dismiss toast when navigating away from current week
  useEffect(() => {
    if (!isCurrentWeek) setPullUpToast(null);
  }, [isCurrentWeek]);

  // Auto-sync Google Calendar on week change or initial connect
  const lastSyncKey = useRef<string | null>(null);
  const syncGcal = useCallback(async () => {
    const key = `${weekOf}:${gcal.hasAccounts}:${gcal.accounts.length}`;
    console.log(`[dashboard] syncGcal check: key=${key}, lastKey=${lastSyncKey.current}, hasAccounts=${gcal.hasAccounts}, weekOf=${weekOf}`);
    if (gcal.hasAccounts && weekOf && lastSyncKey.current !== key) {
      lastSyncKey.current = key;
      console.log('[dashboard] triggering auto-sync...');
      await gcal.sync(weekOf);
      console.log('[dashboard] auto-sync done, mutating blocks...');
      mutateBlocks();
    }
  }, [gcal.hasAccounts, gcal.accounts.length, weekOf, gcal.sync, mutateBlocks]);

  useEffect(() => {
    syncGcal();
  }, [syncGcal]);

  // Fetch calendar sources when gcal connects
  useEffect(() => {
    if (gcal.hasAccounts) {
      mutateSources();
    }
  }, [gcal.hasAccounts, gcal.accounts.length, mutateSources]);

  // Filter fixed blocks by visibility state
  const filteredBlocks = useMemo(() => {
    if (!fixedBlocks) return [];
    const result = fixedBlocks.filter(block => {
      // User-created blocks: controlled by fixedBlocks toggle
      if (block.userCreated) {
        return visibility.fixedBlocks;
      }
      // Google Calendar blocks: controlled by their calendar toggle
      if (block.googleCalendarId) {
        return isGoogleCalendarVisible(block.googleCalendarId);
      }
      // Legacy google blocks without calendar id: show if fixedBlocks visible
      if (block.googleEventId) {
        return visibility.fixedBlocks;
      }
      return true;
    });
    console.log(`[dashboard] filteredBlocks: ${result.length}/${fixedBlocks.length} blocks visible (google visible: ${result.filter(b => b.googleEventId).length})`);
    return result;
  }, [fixedBlocks, visibility.fixedBlocks, isGoogleCalendarVisible]);

  // Auto-load first session messages
  useEffect(() => {
    if (activeSessionId && messages.length === 0) {
      fetchMessages(activeSessionId);
    }
  }, [activeSessionId, messages.length, fetchMessages]);

  // Refresh slots after chat sends (AI may have created tasks/blocks)
  const handleChatSend = async (text: string) => {
    await sendMessage(text);
    mutateTasks();
    mutateSlots();
  };

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar: Chat */}
        <Sidebar
          messages={messages}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSend={handleChatSend}
          onClear={clearMessages}
          onSwitchSession={switchSession}
          onCreateSession={createSession}
          onRenameSession={renameSession}
          onDeleteSession={deleteSession}
          loading={chatLoading}
          projectScope={projectScope}
          onExitProjectScope={exitProjectScope}
          onEnterProjectScope={enterProjectScope}
          onSettingsClick={() => setShowSettings(!showSettings)}
        />

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0 bg-bg-secondary relative">
          {/* Calendar + right sidebar row */}
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0">
              <CalendarView
                weekOf={weekOf}
                slots={slots}
                fixedBlocks={filteredBlocks}
                tasks={tasks}
                isCurrentWeek={isCurrentWeek}
                onNavigateWeek={navigateWeek}
                onGoToToday={goToToday}
                onSlotUpdate={updateSlot}
                onSlotDelete={deleteSlot}
                onMergeMove={mergeMove}
                onBlockUpdate={(id, updates) => updateFixedBlock(id, updates)}
                onBlockDelete={deleteFixedBlock}
                onAddFixedBlock={(block) => addFixedBlock({ ...block, userCreated: true })}
                onGenerateSchedule={generateSchedule}
                generatingSchedule={generating}
              />
            </div>
            <CalendarSourcesSidebar
              sources={sources}
              visibility={visibility}
              onToggleFixedBlocks={toggleFixedBlocks}
              onToggleGoogleCalendar={toggleGoogleCalendar}
              onToggleScheduling={toggleScheduling}
              hasGoogleCalendar={gcal.hasAccounts}
            />
          </div>

          {/* Task list (bottom) */}
          <div className="h-[220px] min-h-[180px] border-t border-border bg-bg-primary overflow-auto">
            <TaskList
              tasks={tasks}
              scheduledSlots={slots}
              onToggleComplete={handleToggleComplete}
              onUpdateTask={updateTask}
              onDelete={deleteTask}
              onSlotUpdate={updateSlot}
              onAddSubtask={addSubtask}
              onDeleteAll={deleteAllTasks}
              onNewProjectChat={createProjectChat}
            />
          </div>

          {/* Pull-up toast */}
          {pullUpToast && (
            <PullUpToast
              taskName={pullUpToast.taskName}
              onPullUp={handlePullUp}
              onDismiss={() => setPullUpToast(null)}
            />
          )}
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <SettingsPanel
          preferences={preferences || { ...DEFAULT_PREFERENCES, id: '', userId: '', createdAt: '', updatedAt: '' }}
          onUpdate={async (updates) => {
            const result = await updatePreferences(updates);
            mutateTasks(); // Refresh tasks in case colors changed
            return result;
          }}
          onClose={() => setShowSettings(false)}
          gcal={{
            accounts: gcal.accounts,
            syncing: gcal.syncing,
            onSync: async () => {
              await gcal.sync(weekOf);
              mutateBlocks();
              mutateSources();
            },
            onDisconnect: async (googleEmail: string) => {
              await gcal.disconnect(googleEmail);
              mutateBlocks();
              mutateSources();
            },
          }}
        />
      )}
    </div>
  );
}
