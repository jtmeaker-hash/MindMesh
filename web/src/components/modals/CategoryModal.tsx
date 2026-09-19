import React, { useState, useEffect } from 'react';
import { X, Trash2, Check } from 'lucide-react';
import { Category } from '../../types';

interface CategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  category?: Category | null;
  onSave: (category: Category) => void;
  onDelete?: (categoryId: string) => void;
}

const PALETTE = [
  '#06B6D4', // Cyan
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#8B5CF6', // Violet
  '#EC4899', // Rose
  '#38BDF8', // Sky
  '#F97316', // Orange
  '#14B8A6', // Teal
];

export const CategoryModal: React.FC<CategoryModalProps> = ({
  isOpen,
  onClose,
  category,
  onSave,
  onDelete,
}) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]);

  useEffect(() => {
    if (category) {
      setName(category.name);
      setColor(category.color || PALETTE[0]);
    } else {
      setName('');
      setColor(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
    }
  }, [category, isOpen]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const savedCategory: Category = {
      id: category?.id || `cat-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: name.trim(),
      color,
      createdAt: category?.createdAt || new Date().toISOString(),
    };

    onSave(savedCategory);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 7, 18, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
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
          padding: '20px 20px 32px 20px',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.8)',
          width: '100%',
          maxWidth: 500,
          margin: '0 auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: '#334155',
            margin: '0 auto 16px auto',
          }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F8FAFC' }}>
            {category ? 'Edit Category' : 'New Category'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: 'none',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              CATEGORY NAME *
            </label>
            <input
              type="text"
              required
              placeholder="e.g., Home, Health, Fitness, Money"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 12,
                backgroundColor: '#1E293B',
                border: '1px solid #334155',
                color: '#F8FAFC',
                fontSize: 15,
                fontWeight: 600,
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>
              BRANCH COLOR
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {PALETTE.map((c) => {
                const isSelected = color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: c,
                      border: isSelected ? '3px solid #FFFFFF' : '2px solid transparent',
                      boxShadow: isSelected ? `0 0 14px ${c}` : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {isSelected && <Check size={18} color="#FFFFFF" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            {category && onDelete && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete category "${category.name}" and all its reminders?`)) {
                    onDelete(category.id);
                    onClose();
                  }
                }}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Delete Category"
              >
                <Trash2 size={18} />
              </button>
            )}

            <button
              type="submit"
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: 12,
                backgroundColor: color,
                border: 'none',
                color: '#ffffff',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: `0 4px 14px ${color}66`,
              }}
            >
              {category ? 'Save Changes' : 'Create Category'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
