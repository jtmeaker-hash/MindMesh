import React from 'react';
import { Plus, FolderPlus, CheckSquare, X } from 'lucide-react';
import { Category } from '../../types';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  focusedCategory: Category | null;
  onSelectAddReminder: (preselectedCategoryId?: string) => void;
  onSelectAddCategory: () => void;
}

export const QuickAddModal: React.FC<QuickAddModalProps> = ({
  isOpen,
  onClose,
  focusedCategory,
  onSelectAddReminder,
  onSelectAddCategory,
}) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 7, 18, 0.65)',
        backdropFilter: 'blur(6px)',
        zIndex: 950,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#0F172A',
          borderTop: '1px solid rgba(255, 255, 255, 0.12)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          padding: '18px 20px 32px 20px',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.8)',
          width: '100%',
          maxWidth: 460,
          margin: '0 auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            backgroundColor: '#334155',
            margin: '0 auto 14px auto',
          }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <h3 style={{ fontSize: 17, fontWeight: 700, color: '#F8FAFC' }}>Quick Create</h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: 'none',
              borderRadius: '50%',
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* New Reminder */}
          <button
            type="button"
            onClick={() => {
              onSelectAddReminder(focusedCategory?.id);
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '15px 18px',
              borderRadius: 16,
              backgroundColor: '#6366F1',
              border: 'none',
              color: '#ffffff',
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(99, 102, 241, 0.4)',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <CheckSquare size={20} color="#ffffff" />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>New Reminder / Task</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                {focusedCategory
                  ? `Preselected in "${focusedCategory.name}"`
                  : 'Add title, due date & subtasks'}
              </div>
            </div>
          </button>

          {/* New Category */}
          <button
            type="button"
            onClick={() => {
              onSelectAddCategory();
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '15px 18px',
              borderRadius: 16,
              backgroundColor: '#1E293B',
              border: '1px solid #334155',
              color: '#f8fafc',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <FolderPlus size={20} color="#06B6D4" />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>New Category Branch</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                Create a new focus area in your MindMesh
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
