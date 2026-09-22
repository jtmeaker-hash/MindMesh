import React, { useState, useMemo } from 'react';
import {
  Search,
  Users,
  Phone,
  Filter,
  UserPlus,
  ArrowUpDown,
  Download,
} from 'lucide-react';
import { getContactImportCapability, selectDeviceContacts, deviceRecordToContact, findLikelyDuplicate, resolveImportedContact } from '../../services/contactImport';
import type { DuplicateDecision } from '../../services/contactImport';
import { Contact, ContactSortOption } from '../../types/contact';
import { Reminder } from '../../types';
import { ContactModal } from './ContactModal';
import { ContactDetailModal } from './ContactDetailModal';
import { EmptyState } from '../common/EmptyState';

interface ContactsModuleProps {
  contacts: Contact[];
  onUpdateContacts: React.Dispatch<React.SetStateAction<Contact[]>>;
  contactCategories: string[];
  onUpdateContactCategories: React.Dispatch<React.SetStateAction<string[]>>;
  contactRelationships: string[];
  onUpdateContactRelationships: React.Dispatch<React.SetStateAction<string[]>>;
  reminders: Reminder[];
  onOpenReminderModal?: (reminderId: string) => void;
}

export const ContactsModule: React.FC<ContactsModuleProps> = ({
  contacts,
  onUpdateContacts,
  contactCategories,
  onUpdateContactCategories,
  contactRelationships,
  onUpdateContactRelationships,
  reminders,
  onOpenReminderModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRelationship, setSelectedRelationship] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortOption, setSortOption] = useState<ContactSortOption>('name_asc');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [pendingImports, setPendingImports] = useState<Contact[]>([]);
  const [importDecisions, setImportDecisions] = useState<Record<string, DuplicateDecision>>({});
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());

  // Modals
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  // Filter and sort contacts
  const filteredContacts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return contacts
      .filter((contact) => {
        // Search text matching: name, phone, email, address, notes
        if (q) {
          const matchName = contact.fullName.toLowerCase().includes(q) ||
            (contact.displayName && contact.displayName.toLowerCase().includes(q));
          const matchPhone = contact.phoneNumber.toLowerCase().includes(q) ||
            (contact.secondaryPhoneNumber && contact.secondaryPhoneNumber.toLowerCase().includes(q));
          const matchEmail = contact.email && contact.email.toLowerCase().includes(q);
          const matchAddress = contact.address && contact.address.toLowerCase().includes(q);

          if (!matchName && !matchPhone && !matchEmail && !matchAddress) {
            return false;
          }
        }

        // Relationship filter
        if (selectedRelationship !== 'all' && contact.relationship !== selectedRelationship) {
          return false;
        }

        // Category tag filter
        if (selectedCategory !== 'all' && contact.category !== selectedCategory) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortOption === 'name_asc') {
          const nameA = (a.displayName || a.fullName).toLowerCase();
          const nameB = (b.displayName || b.fullName).toLowerCase();
          return nameA.localeCompare(nameB);
        }
        if (sortOption === 'name_desc') {
          const nameA = (a.displayName || a.fullName).toLowerCase();
          const nameB = (b.displayName || b.fullName).toLowerCase();
          return nameB.localeCompare(nameA);
        }
        if (sortOption === 'relationship') {
          return a.relationship.localeCompare(b.relationship);
        }
        if (sortOption === 'recent') {
          return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
        }
        return 0;
      });
  }, [contacts, searchQuery, selectedRelationship, selectedCategory, sortOption]);

  // CRUD Handlers
  const handleSaveContact = (savedContact: Contact) => {
    onUpdateContacts((prev) => {
      const idx = prev.findIndex((c) => c.id === savedContact.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = savedContact;
        return next;
      }
      return [savedContact, ...prev];
    });

    if (selectedContact?.id === savedContact.id) {
      setSelectedContact(savedContact);
    }
  };

  const handleDeleteContact = (contactId: string) => {
    onUpdateContacts((prev) => prev.filter((c) => c.id !== contactId));
    if (selectedContact?.id === contactId) {
      setSelectedContact(null);
      setIsDetailModalOpen(false);
    }
  };

  const handleAddRelationship = (rel: string) => {
    onUpdateContactRelationships((prev) => (prev.includes(rel) ? prev : [...prev, rel]));
  };

  const handleAddCategory = (cat: string) => {
    onUpdateContactCategories((prev) => (prev.includes(cat) ? prev : [...prev, cat]));
  };

  const handleImportContacts = async () => {
    const capability = getContactImportCapability();
    if (!capability.supported) { setImportMessage(capability.reason || 'Contact import is unavailable. Manual contact entry remains available.'); return; }
    setImporting(true); setImportMessage(null);
    try {
      const records = await selectDeviceContacts();
      const imported = await Promise.all(records.map((record) => deviceRecordToContact(record)));
      setImportDecisions(Object.fromEntries(imported.map((contact) => [contact.id, 'separate' as DuplicateDecision])));
      setSelectedImportIds(new Set(imported.map((contact) => contact.id)));
      setPendingImports(imported);
      if (imported.length === 0) setImportMessage('No contacts were selected.');
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : 'Contact access was cancelled or denied. Manual contact entry is still available.');
    } finally { setImporting(false); }
  };

  const commitImportedContacts = () => {
    const decisions = importDecisions;
    onUpdateContacts((prev) => {
      let next = [...prev];
      for (const imported of pendingImports.filter((contact) => selectedImportIds.has(contact.id))) {
        const result = resolveImportedContact(next, imported, decisions[imported.id] || 'separate');
        if (result.action === 'merge') {
          const merged = result.contacts[0];
          next = next.map((contact) => contact.id === merged.id ? merged : contact);
        } else if (result.action === 'separate') {
          next = [...result.contacts, ...next];
        }
      }
      return next;
    });
    const importedCount = pendingImports.filter((contact) => selectedImportIds.has(contact.id) && importDecisions[contact.id] !== 'skip').length;
    setImportMessage(`Imported ${importedCount} contact${importedCount === 1 ? '' : 's'}.`);
    setPendingImports([]);
    setImportDecisions({});
    setSelectedImportIds(new Set());
  };

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Linked reminders for selected contact
  const linkedReminders = useMemo(() => {
    if (!selectedContact) return [];
    return reminders.filter((r) => r.linkedContactId === selectedContact.id);
  }, [selectedContact, reminders]);

  return (
    <div
      className="mm-module contacts-module"
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        backgroundColor: '#080B12',
        color: '#F8FAFC',
        padding: '16px 20px 80px 20px',
        maxWidth: 960,
        margin: '0 auto',
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              backgroundColor: 'rgba(99, 102, 241, 0.16)',
              color: '#818cf8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Users size={20} />
          </div>
          <div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                margin: 0,
                color: '#f8fafc',
              }}
            >
              Contact Book
            </h1>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0 0' }}>
              {contacts.length} {contacts.length === 1 ? 'contact' : 'contacts'} saved • Linkable to reminders
            </p>
          </div>
        </div>

        {/* Add Contact CTA */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => {
            setEditingContact(null);
            setIsEditModalOpen(true);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            borderRadius: 999,
            border: 'none',
            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
            color: '#ffffff',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
            transition: 'transform 0.15s ease',
          }}
        >
          <UserPlus size={16} />
          <span>Add Contact</span>
        </button>
        <button type="button" onClick={handleImportContacts} disabled={importing} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 999, border: '1px solid rgba(34,211,238,.35)', background: 'rgba(34,211,238,.12)', color: '#67e8f9', fontSize: 13, fontWeight: 600, cursor: importing ? 'wait' : 'pointer' }}>
          <Download size={16} /> <span>{importing ? 'Importing…' : 'Import Contacts'}</span>
        </button>
        </div>
      </div>
      {importMessage && <div role="status" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 10, background: 'rgba(34,211,238,.1)', border: '1px solid rgba(34,211,238,.25)', color: '#a5f3fc', fontSize: 12 }}>{importMessage}</div>}

      {pendingImports.length > 0 && (
        <div role="dialog" aria-label="Review imported contacts" style={{ marginBottom: 16, padding: 14, borderRadius: 16, background: 'rgba(15,23,42,.92)', border: '1px solid rgba(34,211,238,.35)', boxShadow: '0 12px 32px rgba(0,0,0,.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div><strong>Review contacts</strong><div style={{ fontSize: 12, color: '#94a3b8' }}>Select contacts to save and choose how possible duplicates should be handled.</div></div>
            <button type="button" onClick={() => setPendingImports([])} style={{ background: 'transparent', border: 0, color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: '#cbd5e1' }}><input type="checkbox" checked={selectedImportIds.size === pendingImports.length} onChange={(event) => setSelectedImportIds(event.target.checked ? new Set(pendingImports.map((contact) => contact.id)) : new Set())} /> Select all</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
            {pendingImports.map((contact) => {
              const duplicate = findLikelyDuplicate(contacts, { name: [contact.fullName], tel: [contact.phoneNumber], email: contact.email ? [contact.email] : [] });
              return <div key={contact.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,.04)' }}><input type="checkbox" checked={selectedImportIds.has(contact.id)} onChange={(event) => setSelectedImportIds((prev) => { const next = new Set(prev); if (event.target.checked) next.add(contact.id); else next.delete(contact.id); return next; })} aria-label={`Select ${contact.fullName}`} />
                <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700 }}>{contact.displayName || contact.fullName}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{duplicate ? `Possible duplicate of ${duplicate.displayName || duplicate.fullName}` : 'New contact'}{contact.phoneNumber ? ` • ${contact.phoneNumber}` : ''}</div></div>
                <select aria-label={`Import decision for ${contact.fullName}`} value={importDecisions[contact.id] || 'separate'} onChange={(event) => setImportDecisions((prev) => ({ ...prev, [contact.id]: event.target.value as DuplicateDecision }))} style={{ width: 112, padding: '6px 8px', borderRadius: 8, background: '#1e293b', color: '#f8fafc', border: '1px solid #475569' }}>
                  <option value="separate">Import separate</option><option value="merge" disabled={!duplicate}>Merge</option><option value="skip">Skip</option>
                </select>
              </div>;
            })}
          </div>
          <button type="button" onClick={commitImportedContacts} style={{ marginTop: 12, width: '100%', padding: '10px 14px', borderRadius: 10, border: 0, background: '#0891b2', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Import selected contacts</button>
        </div>
      )}

      {/* Search and Filters Bar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          marginBottom: 20,
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderRadius: 14,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <Search size={16} color="#94a3b8" />
          <input
            type="text"
            placeholder="Search by name, phone, email, or address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#f8fafc',
              fontSize: 13,
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Filter Pills & Sort Dropdown */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {/* Relationship filter pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            <button
              type="button"
              onClick={() => setSelectedRelationship('all')}
              style={{
                padding: '5px 12px',
                borderRadius: 999,
                border: 'none',
                backgroundColor: selectedRelationship === 'all' ? '#6366f1' : 'rgba(255, 255, 255, 0.06)',
                color: selectedRelationship === 'all' ? '#ffffff' : '#94a3b8',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              All ({contacts.length})
            </button>

            {Array.from(new Set(contacts.map((c) => c.relationship))).map((rel) => {
              const count = contacts.filter((c) => c.relationship === rel).length;
              return (
                <button
                  key={rel}
                  type="button"
                  onClick={() => setSelectedRelationship(selectedRelationship === rel ? 'all' : rel)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 999,
                    border: 'none',
                    backgroundColor: selectedRelationship === rel ? '#6366f1' : 'rgba(255, 255, 255, 0.06)',
                    color: selectedRelationship === rel ? '#ffffff' : '#94a3b8',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {rel} ({count})
                </button>
              );
            })}
          </div>

          {/* Tag/Category filter + Sort Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {contactCategories.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Filter size={14} color="#94a3b8" />
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  style={{
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#cbd5e1',
                    padding: '4px 8px',
                    borderRadius: 8,
                    fontSize: 12,
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="all">All tags</option>
                  {contactCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ArrowUpDown size={14} color="#94a3b8" />
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as ContactSortOption)}
              style={{
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#cbd5e1',
                padding: '4px 8px',
                borderRadius: 8,
                fontSize: 12,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="name_asc">Alphabetical (A–Z)</option>
              <option value="name_desc">Alphabetical (Z–A)</option>
              <option value="relationship">Relationship</option>
              <option value="recent">Recently Updated</option>
            </select>
            </div>
          </div>
        </div>
      </div>

      {/* Contacts Cards Grid */}
      {filteredContacts.length === 0 ? (
        <EmptyState
          title="No contacts found"
          description={
            searchQuery || selectedRelationship !== 'all' || selectedCategory !== 'all'
              ? 'Try modifying your search query, relationship, or tag filter.'
              : 'Add your friends, doctors, managers, and emergency contacts to link them to your MindMesh tasks.'
          }
          actionLabel="Add First Contact"
          onAction={() => {
            setSearchQuery('');
            setSelectedRelationship('all');
            setSelectedCategory('all');
            setEditingContact(null);
            setIsEditModalOpen(true);
          }}
          icon={Users}
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
          }}
        >
          {filteredContacts.map((contact) => {
            const initials = getInitials(contact.displayName || contact.fullName);
            const contactLinkedCount = reminders.filter((r) => r.linkedContactId === contact.id).length;

            return (
              <div
                key={contact.id}
                onClick={() => {
                  setSelectedContact(contact);
                  setIsDetailModalOpen(true);
                }}
                style={{
                  padding: 14,
                  borderRadius: 16,
                  backgroundColor: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: 'pointer',
                  transition: 'transform 0.15s ease, border-color 0.15s ease, background 0.15s ease',
                  position: 'relative',
                }}
                className="contact-card"
              >
                {/* Avatar */}
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    backgroundColor: '#1E293B',
                    border: '1.5px solid rgba(99, 102, 241, 0.35)',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {contact.photo ? (
                    <img
                      src={contact.photo}
                      alt={contact.fullName}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#a5b4fc' }}>
                      {initials}
                    </span>
                  )}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h3
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#f8fafc',
                        margin: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {contact.displayName || contact.fullName}
                    </h3>

                    {contactLinkedCount > 0 && (
                      <span
                        title={`${contactLinkedCount} linked task(s)`}
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          backgroundColor: 'rgba(99, 102, 241, 0.2)',
                          color: '#a5b4fc',
                          padding: '1px 6px',
                          borderRadius: 999,
                        }}
                      >
                        {contactLinkedCount} linked
                      </span>
                    )}
                  </div>

                  {contact.displayName && contact.displayName !== contact.fullName && (
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                      {contact.fullName}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <span
                      style={{
                        fontSize: 11,
                        color: '#34d399',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                      }}
                    >
                      <Phone size={10} />
                      {contact.phoneNumber}
                    </span>
                    <span style={{ fontSize: 10, color: '#64748b' }}>•</span>
                    <span style={{ fontSize: 11, color: '#818cf8', fontWeight: 600 }}>
                      {contact.relationship}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <ContactModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingContact(null);
        }}
        contact={editingContact}
        relationships={contactRelationships}
        categories={contactCategories}
        onSave={handleSaveContact}
        onDelete={handleDeleteContact}
        onAddRelationship={handleAddRelationship}
        onAddCategory={handleAddCategory}
      />

      <ContactDetailModal
        contact={selectedContact}
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedContact(null);
        }}
        onEdit={(contactToEdit) => {
          setIsDetailModalOpen(false);
          setEditingContact(contactToEdit);
          setIsEditModalOpen(true);
        }}
        onDelete={handleDeleteContact}
        linkedReminders={linkedReminders}
        onOpenReminder={(remId) => {
          setIsDetailModalOpen(false);
          onOpenReminderModal?.(remId);
        }}
      />
    </div>
  );
};
