import React from 'react';
import {
  X,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Edit2,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { Contact } from '../../types/contact';
import { Reminder } from '../../types';

interface ContactDetailModalProps {
  contact: Contact | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (contact: Contact) => void;
  onDelete: (contactId: string) => void;
  linkedReminders?: Reminder[];
  onOpenReminder?: (reminderId: string) => void;
}

export const ContactDetailModal: React.FC<ContactDetailModalProps> = ({
  contact,
  isOpen,
  onClose,
  onEdit,
  onDelete,
  linkedReminders = [],
  onOpenReminder,
}) => {
  if (!isOpen || !contact) return null;

  const initials = (contact.displayName || contact.fullName)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || '')
    .join('');

  const encodedAddress = encodeURIComponent(contact.address || '');
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

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
          maxHeight: '88vh',
          overflowY: 'auto',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.8)',
          width: '100%',
          maxWidth: 580,
          margin: '0 auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab bar */}
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: '#334155',
            margin: '0 auto 16px auto',
          }}
        />

        {/* Top Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: 6,
                backgroundColor: 'rgba(99, 102, 241, 0.2)',
                color: '#a5b4fc',
                border: '1px solid rgba(99, 102, 241, 0.3)',
              }}
            >
              {contact.relationship}
            </span>
            {contact.category && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 6,
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  color: '#94a3b8',
                }}
              >
                {contact.category}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => onEdit(contact)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 12px',
                borderRadius: 10,
                backgroundColor: 'rgba(99, 102, 241, 0.16)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                color: '#818cf8',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Edit2 size={13} />
              <span>Edit</span>
            </button>

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
        </div>

        {/* Hero Card */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: 16,
            borderRadius: 18,
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            marginBottom: 20,
          }}
        >
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: '50%',
              backgroundColor: '#1E293B',
              border: '2px solid rgba(99, 102, 241, 0.5)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
          >
            {contact.photo ? (
              <img
                src={contact.photo}
                alt={contact.fullName}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: 24, fontWeight: 800, color: '#a5b4fc' }}>
                {initials}
              </span>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: '#f8fafc',
                margin: 0,
                lineHeight: 1.2,
                wordBreak: 'break-word',
              }}
            >
              {contact.fullName}
            </h2>
            {contact.displayName && (
              <div style={{ fontSize: 13, color: '#818cf8', fontWeight: 600, marginTop: 2 }}>
                “{contact.displayName}”
              </div>
            )}
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
              Added {new Date(contact.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
          {/* Phone call action */}
          <a
            href={`tel:${contact.phoneNumber.replace(/\s+/g, '')}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              padding: '12px 8px',
              borderRadius: 14,
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#34d399',
              textDecoration: 'none',
              textAlign: 'center',
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            <Phone size={18} />
            <span>Call</span>
          </a>

          {/* Email action */}
          {contact.email ? (
            <a
              href={`mailto:${contact.email}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                padding: '12px 8px',
                borderRadius: 14,
                backgroundColor: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                color: '#38bdf8',
                textDecoration: 'none',
                textAlign: 'center',
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              <Mail size={18} />
              <span>Email</span>
            </a>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                padding: '12px 8px',
                borderRadius: 14,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                color: '#475569',
                textAlign: 'center',
                fontSize: 12,
              }}
            >
              <Mail size={18} />
              <span>No email</span>
            </div>
          )}

          {/* Map action */}
          {contact.address ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                padding: '12px 8px',
                borderRadius: 14,
                backgroundColor: 'rgba(129, 140, 248, 0.12)',
                border: '1px solid rgba(129, 140, 248, 0.3)',
                color: '#818cf8',
                textDecoration: 'none',
                textAlign: 'center',
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              <MapPin size={18} />
              <span>Directions</span>
            </a>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                padding: '12px 8px',
                borderRadius: 14,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                color: '#475569',
                textAlign: 'center',
                fontSize: 12,
              }}
            >
              <MapPin size={18} />
              <span>No address</span>
            </div>
          )}
        </div>

        {/* Contact Field Details */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 16,
            borderRadius: 16,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            marginBottom: 20,
          }}
        >
          {/* Primary Phone */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ color: '#10b981' }}><Phone size={15} /></div>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Primary Phone</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc' }}>
                  {contact.phoneNumber}
                </div>
              </div>
            </div>
            <a
              href={`tel:${contact.phoneNumber.replace(/\s+/g, '')}`}
              style={{
                fontSize: 12,
                color: '#10b981',
                textDecoration: 'none',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 8,
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
              }}
            >
              Call
            </a>
          </div>

          {/* Secondary Phone if available */}
          {contact.secondaryPhoneNumber && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ color: '#10b981' }}><Phone size={15} /></div>
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Secondary Phone</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc' }}>
                    {contact.secondaryPhoneNumber}
                  </div>
                </div>
              </div>
              <a
                href={`tel:${contact.secondaryPhoneNumber.replace(/\s+/g, '')}`}
                style={{
                  fontSize: 12,
                  color: '#10b981',
                  textDecoration: 'none',
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: 8,
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                }}
              >
                Call
              </a>
            </div>
          )}

          {/* Email */}
          {contact.email && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ color: '#38bdf8' }}><Mail size={15} /></div>
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Email</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc', wordBreak: 'break-all' }}>
                    {contact.email}
                  </div>
                </div>
              </div>
              <a
                href={`mailto:${contact.email}`}
                style={{
                  fontSize: 12,
                  color: '#38bdf8',
                  textDecoration: 'none',
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: 8,
                  backgroundColor: 'rgba(56, 189, 248, 0.1)',
                }}
              >
                Email
              </a>
            </div>
          )}

          {/* Address */}
          {contact.address && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ color: '#a855f7' }}><MapPin size={15} /></div>
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Address</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#f8fafc' }}>
                    {contact.address}
                  </div>
                </div>
              </div>
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 12,
                  color: '#a855f7',
                  textDecoration: 'none',
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: 8,
                  backgroundColor: 'rgba(168, 85, 247, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                <span>Map</span>
                <ExternalLink size={11} />
              </a>
            </div>
          )}

          {/* Birthday */}
          {contact.birthday && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
              <div style={{ color: '#f59e0b' }}><Calendar size={15} /></div>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Birthday</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc' }}>
                  {contact.birthday}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Notes */}
        {contact.notes && (
          <div
            style={{
              padding: 14,
              borderRadius: 14,
              backgroundColor: 'rgba(30, 41, 59, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              marginBottom: 20,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>
              NOTES
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {contact.notes}
            </p>
          </div>
        )}

        {/* Linked MindMesh Reminders */}
        {linkedReminders.length > 0 && (
          <div
            style={{
              padding: 14,
              borderRadius: 14,
              backgroundColor: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              marginBottom: 20,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc' }}>
                LINKED MINDMESH TASKS ({linkedReminders.length})
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {linkedReminders.map((rem) => (
                <div
                  key={rem.id}
                  onClick={() => onOpenReminder?.(rem.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 10,
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    cursor: onOpenReminder ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        backgroundColor: rem.completed ? '#10b981' : '#6366f1',
                      }}
                    />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: rem.completed ? '#94a3b8' : '#f8fafc',
                        textDecoration: rem.completed ? 'line-through' : 'none',
                      }}
                    >
                      {rem.title}
                    </span>
                  </div>

                  {rem.dueDate && (
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      {rem.dueDate}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Delete Contact Button */}
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Are you sure you want to delete ${contact.displayName || contact.fullName}?`)) {
                onDelete(contact.id);
                onClose();
              }
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px',
              borderRadius: 12,
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              color: '#ef4444',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Trash2 size={16} />
            <span>Delete Contact</span>
          </button>
        </div>
      </div>
    </div>
  );
};
