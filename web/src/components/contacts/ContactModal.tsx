import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, Trash2, User, Phone, Mail, MapPin, Calendar } from 'lucide-react';
import { Contact, DEFAULT_RELATIONSHIPS } from '../../types/contact';

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  contact?: Contact | null;
  relationships: string[];
  categories: string[];
  onSave: (contact: Contact) => void;
  onDelete?: (contactId: string) => void;
  onAddRelationship?: (rel: string) => void;
  onAddCategory?: (cat: string) => void;
}

export const ContactModal: React.FC<ContactModalProps> = ({
  isOpen,
  onClose,
  contact,
  relationships,
  categories,
  onSave,
  onDelete,
  onAddRelationship,
  onAddCategory,
}) => {
  const [fullName, setFullName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [secondaryPhoneNumber, setSecondaryPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [relationship, setRelationship] = useState<string>('Friend');
  const [category, setCategory] = useState<string>('Personal');
  const [birthday, setBirthday] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<string | undefined>(undefined);

  const [newRelInput, setNewRelInput] = useState('');
  const [showNewRel, setShowNewRel] = useState(false);
  const [newCatInput, setNewCatInput] = useState('');
  const [showNewCat, setShowNewCat] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (contact) {
      setFullName(contact.fullName || '');
      setDisplayName(contact.displayName || '');
      setPhoneNumber(contact.phoneNumber || '');
      setSecondaryPhoneNumber(contact.secondaryPhoneNumber || '');
      setEmail(contact.email || '');
      setAddress(contact.address || '');
      setRelationship(contact.relationship || 'Friend');
      setCategory(contact.category || 'Personal');
      setBirthday(contact.birthday || '');
      setNotes(contact.notes || '');
      setPhoto(contact.photo);
    } else {
      setFullName('');
      setDisplayName('');
      setPhoneNumber('');
      setSecondaryPhoneNumber('');
      setEmail('');
      setAddress('');
      setRelationship(relationships[0] || 'Friend');
      setCategory(categories[0] || 'Personal');
      setBirthday('');
      setNotes('');
      setPhoto(undefined);
    }
    setShowNewRel(false);
    setShowNewCat(false);
  }, [contact, isOpen, relationships, categories]);

  if (!isOpen) return null;

  // Image handling with compression to thumbnail data URL (< 64KB)
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_DIM = 240;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_DIM) {
            height *= MAX_DIM / width;
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width *= MAX_DIM / height;
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
          setPhoto(compressedDataUrl);
        }
      };
      if (typeof event.target?.result === 'string') {
        img.src = event.target.result;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    setPhoto(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !phoneNumber.trim()) return;

    const now = new Date().toISOString();
    const savedContact: Contact = {
      id: contact?.id || `contact-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      fullName: fullName.trim(),
      displayName: displayName.trim() || undefined,
      phoneNumber: phoneNumber.trim(),
      secondaryPhoneNumber: secondaryPhoneNumber.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      relationship,
      category: category || undefined,
      birthday: birthday || undefined,
      notes: notes.trim() || undefined,
      photo,
      createdAt: contact?.createdAt || now,
      updatedAt: now,
    };

    onSave(savedContact);
    onClose();
  };

  const handleCreateCustomRel = () => {
    const trimmed = newRelInput.trim();
    if (!trimmed) return;
    onAddRelationship?.(trimmed);
    setRelationship(trimmed);
    setNewRelInput('');
    setShowNewRel(false);
  };

  const handleCreateCustomCat = () => {
    const trimmed = newCatInput.trim();
    if (!trimmed) return;
    onAddCategory?.(trimmed);
    setCategory(trimmed);
    setNewCatInput('');
    setShowNewCat(false);
  };

  // Initials generator
  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const initials = getInitials(displayName || fullName || 'New Contact');

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

        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                backgroundColor: 'rgba(99, 102, 241, 0.2)',
                color: '#818cf8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <User size={18} />
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F8FAFC' }}>
              {contact ? 'Edit Contact' : 'New Contact'}
            </h2>
          </div>

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

        {/* Photo Upload Section */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginBottom: 20,
            padding: 14,
            borderRadius: 16,
            backgroundColor: 'rgba(30, 41, 59, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: '#1E293B',
              border: '2px solid rgba(99, 102, 241, 0.4)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}
          >
            {photo ? (
              <img
                src={photo}
                alt="Contact avatar"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: 20, fontWeight: 800, color: '#a5b4fc' }}>
                {initials}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>
              PROFILE PHOTO
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handlePhotoUpload}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 8,
                  backgroundColor: 'rgba(99, 102, 241, 0.2)',
                  border: '1px solid rgba(99, 102, 241, 0.4)',
                  color: '#a5b4fc',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Upload size={14} />
                <span>{photo ? 'Replace Photo' : 'Upload Photo'}</span>
              </button>

              {photo && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '6px 10px',
                    borderRadius: 8,
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    color: '#ef4444',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={13} />
                  <span>Remove</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Names */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>
                FULL NAME *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Sarah Miller"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 10,
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  color: '#F8FAFC',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>
                DISPLAY / NICKNAME
              </label>
              <input
                type="text"
                placeholder="e.g. Dr. Miller"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 10,
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  color: '#F8FAFC',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Relationship & Tag Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>RELATIONSHIP *</label>
                <button
                  type="button"
                  onClick={() => setShowNewRel(!showNewRel)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#818cf8',
                    fontSize: 11,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  + New
                </button>
              </div>

              {showNewRel ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    type="text"
                    placeholder="Custom relationship..."
                    value={newRelInput}
                    onChange={(e) => setNewRelInput(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 8,
                      backgroundColor: '#1E293B',
                      border: '1px solid #6366f1',
                      color: '#fff',
                      fontSize: 12,
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCreateCustomRel}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      backgroundColor: '#6366f1',
                      border: 'none',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Add
                  </button>
                </div>
              ) : (
                <select
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
                    fontSize: 13,
                    outline: 'none',
                  }}
                >
                  {Array.from(new Set([...DEFAULT_RELATIONSHIPS, ...relationships])).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>TAG / CATEGORY</label>
                <button
                  type="button"
                  onClick={() => setShowNewCat(!showNewCat)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#818cf8',
                    fontSize: 11,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  + New
                </button>
              </div>

              {showNewCat ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    type="text"
                    placeholder="Custom category tag..."
                    value={newCatInput}
                    onChange={(e) => setNewCatInput(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 8,
                      backgroundColor: '#1E293B',
                      border: '1px solid #6366f1',
                      color: '#fff',
                      fontSize: 12,
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCreateCustomCat}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      backgroundColor: '#6366f1',
                      border: 'none',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Add
                  </button>
                </div>
              ) : (
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
                    fontSize: 13,
                    outline: 'none',
                  }}
                >
                  <option value="">No tag</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Phone Numbers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>
                <Phone size={12} /> PRIMARY PHONE *
              </label>
              <input
                type="tel"
                required
                placeholder="+61 400 000 000"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 10,
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  color: '#F8FAFC',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>
                <Phone size={12} /> SECONDARY PHONE
              </label>
              <input
                type="tel"
                placeholder="Work / landline"
                value={secondaryPhoneNumber}
                onChange={(e) => setSecondaryPhoneNumber(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 10,
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  color: '#F8FAFC',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Email & Birthday */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>
                <Mail size={12} /> EMAIL ADDRESS
              </label>
              <input
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 10,
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  color: '#F8FAFC',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>
                <Calendar size={12} /> BIRTHDAY
              </label>
              <input
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 10,
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  color: '#F8FAFC',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Address */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>
              <MapPin size={12} /> HOME / WORK ADDRESS
            </label>
            <input
              type="text"
              placeholder="e.g. 124 Collins St, Melbourne VIC 3000"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                backgroundColor: '#1E293B',
                border: '1px solid #334155',
                color: '#F8FAFC',
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>
              NOTES & SPECIAL DETAILS
            </label>
            <textarea
              rows={2}
              placeholder="Important details, medical notes, work schedule..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                backgroundColor: '#1E293B',
                border: '1px solid #334155',
                color: '#F8FAFC',
                fontSize: 13,
                outline: 'none',
                resize: 'none',
              }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            {contact && onDelete && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete contact "${contact.displayName || contact.fullName}"?`)) {
                    onDelete(contact.id);
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
                title="Delete Contact"
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
                backgroundColor: '#6366F1',
                border: 'none',
                color: '#ffffff',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
              }}
            >
              {contact ? 'Save Contact' : 'Create Contact'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
