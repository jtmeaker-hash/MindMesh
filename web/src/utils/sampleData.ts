import { Category, Reminder } from '../types';

export const INITIAL_CATEGORIES: Category[] = [
  {
    id: 'cat-car',
    name: 'Car',
    color: '#06B6D4', // Vibrant Cyan
    icon: 'Car',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'cat-health',
    name: 'Health',
    color: '#10B981', // Calm Emerald
    icon: 'Heart',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'cat-errands',
    name: 'Errands',
    color: '#F59E0B', // Warm Amber
    icon: 'ShoppingBag',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'cat-home',
    name: 'Home',
    color: '#8B5CF6', // Soft Violet
    icon: 'Home',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'cat-work',
    name: 'Work',
    color: '#EC4899', // Electric Rose
    icon: 'Briefcase',
    createdAt: new Date().toISOString(),
  },
];

export const INITIAL_REMINDERS: Reminder[] = [
  {
    id: 'rem-1',
    categoryId: 'cat-car',
    title: 'Book service',
    notes: 'Needs 60,000 km routine maintenance',
    dueDate: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
    dueTime: '10:00',
    priority: 'high',
    completed: false,
    createdAt: new Date().toISOString(),
    subtasks: [
      {
        id: 'sub-1-1',
        reminderId: 'rem-1',
        title: 'Call mechanic',
        completed: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'sub-1-2',
        reminderId: 'rem-1',
        title: 'Ask for quote',
        completed: false,
        createdAt: new Date().toISOString(),
      },
    ],
  },
  {
    id: 'rem-2',
    categoryId: 'cat-car',
    title: 'Renew registration',
    notes: 'Check vehicle inspection document first',
    dueDate: new Date(Date.now() + 86400000 * 5).toISOString().split('T')[0],
    priority: 'medium',
    completed: false,
    createdAt: new Date().toISOString(),
    subtasks: [],
  },
  {
    id: 'rem-3',
    categoryId: 'cat-health',
    title: 'Book dentist',
    notes: 'Dr. Miller routine clean',
    dueDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
    priority: 'high',
    completed: false,
    createdAt: new Date().toISOString(),
    subtasks: [],
  },
  {
    id: 'rem-4',
    categoryId: 'cat-health',
    title: 'Refill prescription',
    notes: 'CVS on 4th street',
    priority: 'medium',
    completed: false,
    createdAt: new Date().toISOString(),
    subtasks: [],
  },
  {
    id: 'rem-5',
    categoryId: 'cat-errands',
    title: 'Buy groceries',
    notes: 'For weekend dinner meal prep',
    priority: 'medium',
    completed: false,
    createdAt: new Date().toISOString(),
    subtasks: [
      {
        id: 'sub-5-1',
        reminderId: 'rem-5',
        title: 'Milk',
        completed: true,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      {
        id: 'sub-5-2',
        reminderId: 'rem-5',
        title: 'Bread',
        completed: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'sub-5-3',
        reminderId: 'rem-5',
        title: 'Coffee',
        completed: false,
        createdAt: new Date().toISOString(),
      },
    ],
  },
  {
    id: 'rem-comp-1',
    categoryId: 'cat-health',
    title: 'Annual health checkup',
    notes: 'All lab results clear',
    priority: 'medium',
    completed: true,
    createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
    completedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    subtasks: [
      {
        id: 'sub-c1-1',
        reminderId: 'rem-comp-1',
        title: 'Fast before blood test',
        completed: true,
        createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
        completedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      },
    ],
  },
  {
    id: 'rem-comp-2',
    categoryId: 'cat-car',
    title: 'Wash car & vacuum',
    notes: 'Done at local wash',
    priority: 'low',
    completed: true,
    createdAt: new Date(Date.now() - 86400000 * 6).toISOString(),
    completedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    subtasks: [],
  },
];
