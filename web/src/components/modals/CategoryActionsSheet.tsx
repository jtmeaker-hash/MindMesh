import React from 'react';
import { Plus, Edit3, Trash2, X, EyeOff } from 'lucide-react';
import { Category } from '../../types';

interface CategoryActionsSheetProps {
  category: Category | null;
  isOpen: boolean;
  onClose: () => void;
  onAddReminder: (categoryId: string) => void;
  onEditCategory: (category: Category) => void;
  onDeleteCategory: (categoryId: string) => void;
  onUnfocus: () => void;
}

export const CategoryActionsSheet: React.FC<CategoryActionsSheetProps> = ({
  category,
  isOpen,
  onClose,
  onAddReminder,
  onEditCategory,
  onDeleteCategory,
  onUnfocus,
}) => {
  if (!isOpen || !category) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 7, 18, 0.65)',
        backdropFilter: 'blur(6px)',
        zIndex: 900,
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
          padding: '18px 20px 28px 20px',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.8)',
          width: '100%',
          maxWidth: 480,
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

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                backgroundColor: category.color,
                boxShadow: `0 0 10px ${category.color}`,
              }}
            />
            <div>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: '#f8fafc' }}>{category.name}</h3>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Category Branch Focused</span>
            </div>
          </div>

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

        {/* Action List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Add Reminder in this category */}
          <button
            type="button"
            onClick={() => {
              onAddReminder(category.id);
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '13px 16px',
              borderRadius: 14,
              backgroundColor: `${category.color}22`,
              border: `1.5px solid ${category.color}88`,
              color: '#ffffff',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <Plus size={18} color={category.color} strokeWidth={2.5} />
            <span>Add Reminder in {category.name}</span>
          </button>

          {/* Edit Category */}
          <button
            type="button"
            onClick={() => {
              onEditCategory(category);
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              borderRadius: 14,
              backgroundColor: '#1E293B',
              border: '1px solid #334155',
              color: '#f1f5f9',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Edit3 size={17} color="#94a3b8" />
            <span>Edit Category</span>
          </button>

          {/* Unfocus / View Entire Mesh */}
          <button
            type="button"
            onClick={() => {
              onUnfocus();
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              borderRadius: 14,
              backgroundColor: '#1E293B',
              border: '1px solid #334155',
              color: '#94a3b8',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <EyeOff size={17} />
            <span>Unfocus Branch (View All)</span>
          </button>

          {/* Delete Category */}
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete category "${category.name}" and all its tasks?`)) {
                onDeleteCategory(category.id);
                onClose();
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              borderRadius: 14,
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              color: '#ef4444',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Trash2 size={17} />
            <span>Delete Category</span>
          </button>
        </div>
      </div>
    </div>
  );
};
