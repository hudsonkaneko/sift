'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import TaskList from '@/components/tasks/TaskList';
import CalendarView from '@/components/calendar/CalendarView';
import CalendarSourcesSidebar from '@/components/calendar/CalendarSourcesSidebar';
import SettingsPanel from '@/components/settings/SettingsPanel';
import { useTasks } from '@/hooks/useTasks';
import { usePreferences } from '@/hooks/usePreferences';
import { useFixedBlocks } from '@/hooks/useFixedBlocks';
import { useSchedule } from '@/hooks/useSchedule';
import { useChat } from '@/hooks/useChat';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';
import { useCalendarSources } from '@/hooks/useCalendarSources';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const { tasks, toggleComplete, updateTask, deleteTask, addSubtask, deleteAllTasks } = useTasks();
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
    switchSession,
    createSession,
    renameSession,
    deleteSession,
    sendMessage,
    clearMessages,
    fetchMessages,
  } = useChat();

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
    mutateSlots();
  };

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      <TopBar onSettingsClick={() => setShowSettings(!showSettings)} />

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
        />

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0 bg-bg-secondary">
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
              onToggleComplete={toggleComplete}
              onUpdateTask={updateTask}
              onDelete={deleteTask}
              onSlotUpdate={updateSlot}
              onAddSubtask={addSubtask}
              onDeleteAll={deleteAllTasks}
            />
          </div>
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && preferences && (
        <SettingsPanel
          preferences={preferences}
          onUpdate={updatePreferences}
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
