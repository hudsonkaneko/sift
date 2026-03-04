'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import TaskList from '@/components/tasks/TaskList';
import CalendarView from '@/components/calendar/CalendarView';
import SettingsPanel from '@/components/settings/SettingsPanel';
import { useTasks } from '@/hooks/useTasks';
import { usePreferences } from '@/hooks/usePreferences';
import { useFixedBlocks } from '@/hooks/useFixedBlocks';
import { useSchedule } from '@/hooks/useSchedule';
import { useChat } from '@/hooks/useChat';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const { tasks, toggleComplete, updateTask, deleteTask, addSubtask, deleteAllTasks } = useTasks();
  const { preferences, updatePreferences } = usePreferences();
  const { fixedBlocks, addFixedBlock, updateFixedBlock, deleteFixedBlock } = useFixedBlocks();
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
          {/* Calendar view (top) */}
          <div className="flex-1 min-h-0">
            <CalendarView
              weekOf={weekOf}
              slots={slots}
              fixedBlocks={fixedBlocks}
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
        />
      )}
    </div>
  );
}
