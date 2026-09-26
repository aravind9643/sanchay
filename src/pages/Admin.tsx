import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import {
  createSuperAdminClient,
  getActiveServiceRoleKey,
  setActiveServiceRoleKey,
  isDeveloperUnlocked,
  setDeveloperUnlocked,
  getDeveloperPIN,
} from '../lib/superAdmin';
import { formatPaise, rupeesToPaise, paiseToRupees } from '../lib/money';
import { haptic } from '../lib/haptics';
import {
  Panel, Stat, List, Row, Tag, Sheet, Field, Notice,
  Segments, initials, roleLabel, fmtDate, fmtDateTime, ago,
} from '../components/ui';
import {
  IconShield, IconTrash, IconEdit, IconLock, IconKey,
  IconDownload, IconWrench, IconBank, IconAudit, IconExpenses,
} from '../components/icons';
import type { Role, AuditRow } from '../lib/types';

interface DbGroup {
  id: string;
  name: string;
  created_at: string;
  setup_complete: boolean;
  monthly_contribution_paise: number;
}

interface DbMember {
  id: string;
  group_id: string;
  auth_user_id: string | null;
  full_name: string;
  phone: string | null;
  is_active: boolean;
  joined_on: string;
  nominee_name: string | null;
  nominee_phone: string | null;
  role?: string;
}

interface DbRoleAssignment {
  id: string;
  group_id: string;
  member_id: string;
  role: Role;
  start_date: string;
  end_date: string | null;
}

interface DbLoan {
  id: string;
  group_id: string;
  borrower_id: string;
  principal_paise: number;
  status: string;
  purpose: string | null;
  requested_at: string;
}

interface DbContribution {
  id: string;
  group_id: string;
  member_id: string;
  period_id: string;
  amount_paise: number;
  paid_on: string;
  method: string;
}

interface DbBankStatement {
  id: string;
  group_id: string;
  as_of: string;
  closing_balance_paise: number;
  expected_balance_paise: number;
  difference_paise: number;
  note: string | null;
  uploaded_by: string;
}

interface DbExpense {
  id: string;
  group_id: string;
  category: string;
  description: string;
  amount_paise: number;
  incurred_on: string;
  method: string;
  status: string;
  created_by: string;
}

interface IntegrityIssue {
  severity: 'danger' | 'warn' | 'good';
  title: string;
  desc: string;
  tenant?: string;
}

export default function Admin() {
  const nav = useNavigate();
  const { switchGroup, groups: userGroups } = useSession();

  // Authentication & Developer Verification
  const [unlocked, setUnlocked] = useState(isDeveloperUnlocked);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  // Service role key
  const [serviceKey, setServiceKey] = useState(getActiveServiceRoleKey);
  const [keyInput, setKeyInput] = useState('');
  const [keySheet, setKeySheet] = useState(false);

  // Super Admin Client
  const adminClient = useMemo(() => createSuperAdminClient(serviceKey), [serviceKey]);

  // Tab navigation
  const [tab, setTab] = useState<'groups' | 'members' | 'loans' | 'contributions' | 'bank' | 'expenses' | 'audit' | 'health' | 'backup'>('groups');
  const [search, setSearch] = useState('');

  // Data Collections
  const [groups, setGroups] = useState<DbGroup[]>([]);
  const [members, setMembers] = useState<DbMember[]>([]);
  const [roles, setRoles] = useState<DbRoleAssignment[]>([]);
  const [loans, setLoans] = useState<DbLoan[]>([]);
  const [contributions, setContributions] = useState<DbContribution[]>([]);
  const [bankStatements, setBankStatements] = useState<DbBankStatement[]>([]);
  const [expenses, setExpenses] = useState<DbExpense[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [selectedAudit, setSelectedAudit] = useState<AuditRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Filter Group ID
  const [filterGroupId, setFilterGroupId] = useState<string>('all');

  // Edit / Create Sheets
  const [editGroup, setEditGroup] = useState<DbGroup | null>(null);
  const [editMember, setEditMember] = useState<DbMember | null>(null);
  const [isNewGroup, setIsNewGroup] = useState(false);
  const [isNewMember, setIsNewMember] = useState(false);

  // Role Assignment Sheet
  const [roleMember, setRoleMember] = useState<DbMember | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role>('member');

  // Forms
  const [groupForm, setGroupForm] = useState({ name: '', monthly_rupees: '1000' });
  const [memberForm, setMemberForm] = useState({
    group_id: '',
    full_name: '',
    phone: '',
    nominee_name: '',
    nominee_phone: '',
  });

  // Health Check State
  const [healthIssues, setHealthIssues] = useState<IntegrityIssue[]>([]);
  const [checkingHealth, setCheckingHealth] = useState(false);

  // Verify PIN
  const handleUnlockPin = (e: React.FormEvent) => {
    e.preventDefault();
    haptic(10);
    const validPin = getDeveloperPIN();
    if (pinInput.trim() === validPin) {
      setDeveloperUnlocked(true);
      setUnlocked(true);
      setPinError(null);
    } else {
      setPinError('Invalid Developer PIN. Access denied.');
    }
  };

  // Save Service Role Key
  const handleSaveKey = () => {
    haptic(10);
    if (!keyInput.trim()) return;
    setActiveServiceRoleKey(keyInput.trim());
    setServiceKey(keyInput.trim());
    setKeySheet(false);
  };

  // Load All System Data across database
  const refreshAll = useCallback(async () => {
    if (!adminClient) return;
    setLoading(true);
    setActionError(null);
    try {
      const [grpRes, memRes, roleRes, loanRes, conRes, bankRes, expRes, auditRes] = await Promise.all([
        adminClient.from('groups').select('*').order('created_at', { ascending: false }),
        adminClient.from('members').select('*').order('full_name'),
        adminClient.from('role_assignments').select('*').is('end_date', null),
        adminClient.from('loans').select('*').order('requested_at', { ascending: false }),
        adminClient.from('contributions').select('*').order('paid_on', { ascending: false }),
        adminClient.from('bank_statements').select('*').order('as_of', { ascending: false }),
        adminClient.from('expenses').select('*').order('incurred_on', { ascending: false }),
        adminClient.from('audit_log').select('*').order('occurred_at', { ascending: false }).limit(100),
      ]);

      if (grpRes.error) throw grpRes.error;
      if (memRes.error) throw memRes.error;
      if (roleRes.error) throw roleRes.error;
      if (loanRes.error) throw loanRes.error;
      if (conRes.error) throw conRes.error;

      setGroups(grpRes.data || []);
      setMembers(memRes.data || []);
      setRoles(roleRes.data || []);
      setLoans(loanRes.data || []);
      setContributions(conRes.data || []);
      setBankStatements(bankRes.data || []);
      setExpenses(expRes.data || []);
      setAuditRows((auditRes.data as AuditRow[]) || []);
    } catch (err: any) {
      setActionError(err.message || 'Error querying database with developer privileges.');
    } finally {
      setLoading(false);
    }
  }, [adminClient]);

  useEffect(() => {
    if (unlocked && adminClient) {
      void refreshAll();
    }
  }, [unlocked, adminClient, refreshAll]);

  // Lookup Maps
  const groupMap = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m.full_name])), [members]);
  const activeRolesMap = useMemo(() => {
    const map = new Map<string, Role>();
    roles.forEach((r) => map.set(`${r.group_id}:${r.member_id}`, r.role));
    return map;
  }, [roles]);

  // Total calculated assets
  const totalLentPaise = useMemo(
    () => loans.filter((l) => l.status === 'disbursed').reduce((acc, l) => acc + (l.principal_paise || 0), 0),
    [loans]
  );
  const totalContributionsPaise = useMemo(
    () => contributions.reduce((acc, c) => acc + (c.amount_paise || 0), 0),
    [contributions]
  );

  // Jump into a group (Impersonation / Tenant Switch)
  const handleSwitchToGroup = async (groupId: string, groupName: string) => {
    haptic(10);
    setActionError(null);
    try {
      const userGroup = userGroups.find((g) => g.id === groupId);
      if (!userGroup) {
        setActionError(
          `Your logged-in account is not a registered member of "${groupName}". To open its member dashboard, first add yourself to this group under "All Members".`
        );
        return;
      }
      await switchGroup(groupId);
      nav('/');
    } catch (err: any) {
      setActionError(err.message || 'Could not switch tenant.');
    }
  };

  // Integrity & Health Audit Runner
  const runHealthAudit = useCallback(() => {
    setCheckingHealth(true);
    const issues: IntegrityIssue[] = [];

    // 1. Check groups for dual Cashier / Accountant roles
    groups.forEach((g) => {
      const gRoles = roles.filter((r) => r.group_id === g.id);
      const cashier = gRoles.find((r) => r.role === 'cashier');
      const accountant = gRoles.find((r) => r.role === 'accountant');
      const admin = gRoles.find((r) => r.role === 'admin');

      if (!cashier) {
        issues.push({
          severity: 'warn',
          title: 'Missing Cashier Office',
          desc: `Group "${g.name}" has no active Cashier assigned. Periods and deposits cannot be processed.`,
          tenant: g.name,
        });
      }
      if (!accountant) {
        issues.push({
          severity: 'warn',
          title: 'Missing Accountant Office',
          desc: `Group "${g.name}" has no active Accountant assigned.`,
          tenant: g.name,
        });
      }
      if (cashier && accountant && cashier.member_id === accountant.member_id) {
        issues.push({
          severity: 'danger',
          title: 'Dual-Role Clash Detected',
          desc: `The same member (${memberMap.get(cashier.member_id)}) holds both Cashier and Accountant offices!`,
          tenant: g.name,
        });
      }
      if (!admin) {
        issues.push({
          severity: 'danger',
          title: 'Missing Admin Office',
          desc: `Group "${g.name}" has no Admin office holder! Handover required.`,
          tenant: g.name,
        });
      }
    });

    // 2. Orphan check
    loans.forEach((l) => {
      if (!groupMap.has(l.group_id)) {
        issues.push({
          severity: 'danger',
          title: 'Orphan Loan Record',
          desc: `Loan ${l.id} belongs to a non-existent group ID ${l.group_id}.`,
        });
      }
    });

    if (issues.length === 0) {
      issues.push({
        severity: 'good',
        title: 'All Systems Fully Healthy',
        desc: 'All tenant constraints, office segregation rules, and foreign keys verified cleanly.',
      });
    }

    setHealthIssues(issues);
    setCheckingHealth(false);
  }, [groups, roles, loans, groupMap, memberMap]);

  useEffect(() => {
    if (tab === 'health' && healthIssues.length === 0) {
      runHealthAudit();
    }
  }, [tab, healthIssues.length, runHealthAudit]);

  // Full Database JSON Backup Export
  const handleExportBackup = () => {
    haptic(10);
    const dump = {
      exported_at: new Date().toISOString(),
      platform: 'Sanchay / SavingsClub Multi-Tenant',
      groups,
      members,
      roles,
      loans,
      contributions,
    };
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sanchay-superadmin-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setActionSuccess('Full database JSON export downloaded.');
  };

  // Multi-Selection State for Bulk Actions
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Clear selections when switching tab or group filter
  useEffect(() => {
    setSelectedIds([]);
  }, [tab, filterGroupId]);

  // CRUD: Delete Group
  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    if (!adminClient) return;
    const confirmPrompt = window.confirm(
      `⚠️ CRITICAL DEVELOPER ACTION:\n\nAre you sure you want to permanently DELETE group "${groupName}" (${groupId})?\n\nThis will cascade and remove all its members, ledger rows, and loans!`
    );
    if (!confirmPrompt) return;

    haptic(20);
    setLoading(true);
    setActionError(null);
    try {
      const { error } = await adminClient.from('groups').delete().eq('id', groupId);
      if (error) throw error;
      setSelectedIds((prev) => prev.filter((id) => id !== groupId));
      setActionSuccess(`Group "${groupName}" deleted successfully.`);
      await refreshAll();
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete group.');
    } finally {
      setLoading(false);
    }
  };

  // CRUD: Delete Member
  const handleDeleteMember = async (memberId: string, memberName: string) => {
    if (!adminClient) return;
    const confirmPrompt = window.confirm(
      `⚠️ Delete Member "${memberName}"?\n\nThis removes the member directly from the database.`
    );
    if (!confirmPrompt) return;

    haptic(20);
    setLoading(true);
    setActionError(null);
    try {
      const { error } = await adminClient.from('members').delete().eq('id', memberId);
      if (error) throw error;
      setSelectedIds((prev) => prev.filter((id) => id !== memberId));
      setActionSuccess(`Member "${memberName}" removed.`);
      await refreshAll();
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete member.');
    } finally {
      setLoading(false);
    }
  };

  // CRUD: Generic Bulk Delete
  const handleBulkDelete = async (tableName: string, entityLabel: string) => {
    if (!adminClient || selectedIds.length === 0) return;
    const count = selectedIds.length;
    const confirmPrompt = window.confirm(
      `⚠️ BULK DELETE CONFIRMATION:\n\nAre you sure you want to permanently DELETE ${count} selected ${entityLabel}(s)?\n\nThis developer operation cannot be undone.`
    );
    if (!confirmPrompt) return;

    haptic(30);
    setBulkDeleting(true);
    setActionError(null);
    try {
      if (tableName === 'audit_log') {
        const idsToDelete = selectedIds.map(Number);
        // audit_log is guarded by Postgres trigger trg_audit_immutable.
        // We use the service_role RPC admin_delete_audit_logs which safely bypasses it.
        const { error: rpcErr } = await adminClient.rpc('admin_delete_audit_logs', { p_ids: idsToDelete });
        if (rpcErr) {
          if (rpcErr.message?.includes('function admin_delete_audit_logs') || rpcErr.code === '42883') {
            throw new Error(
              'The "admin_delete_audit_logs" database function is not yet installed in Supabase. Please apply migration 0041_admin_delete_audit_logs.sql or run it in the Supabase SQL Editor.'
            );
          }
          throw rpcErr;
        }
      } else {
        const { error } = await adminClient.from(tableName).delete().in('id', selectedIds);
        if (error) throw error;
      }
      setActionSuccess(`Bulk deleted ${count} ${entityLabel}(s) successfully.`);
      setSelectedIds([]);
      await refreshAll();
    } catch (err: any) {
      setActionError(err.message || `Failed to bulk delete ${entityLabel}(s).`);
    } finally {
      setBulkDeleting(false);
    }
  };

  // Selection toggle helper
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Select all or none for visible items
  const toggleSelectAll = (visibleIds: string[]) => {
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  // CRUD: Save / Update Group
  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminClient) return;
    haptic(10);
    setLoading(true);
    setActionError(null);
    try {
      const payload: Partial<DbGroup> = {
        name: groupForm.name.trim(),
        monthly_contribution_paise: rupeesToPaise(groupForm.monthly_rupees),
      };
      if (isNewGroup) {
        const { error } = await adminClient.from('groups').insert([payload]);
        if (error) throw error;
        setActionSuccess(`Group "${groupForm.name}" created.`);
      } else if (editGroup) {
        const { error } = await adminClient.from('groups').update(payload).eq('id', editGroup.id);
        if (error) throw error;
        setActionSuccess(`Group "${groupForm.name}" updated.`);
      }
      setEditGroup(null);
      setIsNewGroup(false);
      await refreshAll();
    } catch (err: any) {
      setActionError(err.message || 'Failed to save group.');
    } finally {
      setLoading(false);
    }
  };

  // CRUD: Save / Update Member
  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminClient) return;
    haptic(10);
    setLoading(true);
    setActionError(null);
    try {
      const payload: Partial<DbMember> = {
        group_id: memberForm.group_id,
        full_name: memberForm.full_name.trim(),
        phone: memberForm.phone.trim() || null,
        nominee_name: memberForm.nominee_name.trim() || null,
        nominee_phone: memberForm.nominee_phone.trim() || null,
      };
      if (isNewMember) {
        const { error } = await adminClient.from('members').insert([payload]);
        if (error) throw error;
        setActionSuccess(`Member "${memberForm.full_name}" created.`);
      } else if (editMember) {
        const { error } = await adminClient.from('members').update(payload).eq('id', editMember.id);
        if (error) throw error;
        setActionSuccess(`Member "${memberForm.full_name}" updated.`);
      }
      setEditMember(null);
      setIsNewMember(false);
      await refreshAll();
    } catch (err: any) {
      setActionError(err.message || 'Failed to save member.');
    } finally {
      setLoading(false);
    }
  };

  // Role Assignment Action
  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminClient || !roleMember) return;
    haptic(10);
    setLoading(true);
    setActionError(null);
    try {
      // End previous role assignment for this office in this group if changing office holder
      if (selectedRole !== 'member') {
        await adminClient
          .from('role_assignments')
          .update({ end_date: new Date().toISOString().slice(0, 10) })
          .eq('group_id', roleMember.group_id)
          .eq('role', selectedRole)
          .is('end_date', null);
      }

      // End member's existing role assignment
      await adminClient
        .from('role_assignments')
        .update({ end_date: new Date().toISOString().slice(0, 10) })
        .eq('group_id', roleMember.group_id)
        .eq('member_id', roleMember.id)
        .is('end_date', null);

      // Insert new role if not ordinary member
      if (selectedRole !== 'member') {
        const { error: insErr } = await adminClient.from('role_assignments').insert([
          {
            group_id: roleMember.group_id,
            member_id: roleMember.id,
            role: selectedRole,
            start_date: new Date().toISOString().slice(0, 10),
          },
        ]);
        if (insErr) throw insErr;
      }

      setActionSuccess(`Assigned ${roleLabel(selectedRole)} to ${roleMember.full_name}.`);
      setRoleMember(null);
      await refreshAll();
    } catch (err: any) {
      setActionError(err.message || 'Failed to update role assignment.');
    } finally {
      setLoading(false);
    }
  };

  // Filtered lists
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q) || g.id.toLowerCase().includes(q));
  }, [groups, search]);

  const filteredMembers = useMemo(() => {
    let list = members;
    if (filterGroupId !== 'all') {
      list = list.filter((m) => m.group_id === filterGroupId);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (m) =>
        m.full_name.toLowerCase().includes(q) ||
        (m.phone && m.phone.includes(q)) ||
        m.id.toLowerCase().includes(q)
    );
  }, [members, filterGroupId, search]);

  const filteredLoans = useMemo(() => {
    let list = loans;
    if (filterGroupId !== 'all') {
      list = list.filter((l) => l.group_id === filterGroupId);
    }
    return list;
  }, [loans, filterGroupId]);

  const filteredContributions = useMemo(() => {
    let list = contributions;
    if (filterGroupId !== 'all') {
      list = list.filter((c) => c.group_id === filterGroupId);
    }
    return list;
  }, [contributions, filterGroupId]);

  const filteredBankStatements = useMemo(() => {
    let list = bankStatements;
    if (filterGroupId !== 'all') {
      list = list.filter((b) => b.group_id === filterGroupId);
    }
    return list;
  }, [bankStatements, filterGroupId]);

  const filteredExpenses = useMemo(() => {
    let list = expenses;
    if (filterGroupId !== 'all') {
      list = list.filter((e) => e.group_id === filterGroupId);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) => e.description.toLowerCase().includes(q) || e.category.toLowerCase().includes(q));
  }, [expenses, filterGroupId, search]);

  const filteredAuditRows = useMemo(() => {
    let list = auditRows;
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (a) =>
        a.table_name.toLowerCase().includes(q) ||
        a.action.toLowerCase().includes(q) ||
        String(a.row_id).toLowerCase().includes(q)
    );
  }, [auditRows, search]);

  // SCREEN 1: PIN LOCK
  if (!unlocked) {
    return (
      <div className="superadmin-shell">
        <header className="appbar">
          <div className="appbar-inner" style={{ maxWidth: 1120 }}>
            <span className="row-ico coral" style={{ width: 36, height: 36, borderRadius: 10, flex: 'none' }}>
              <IconLock width={18} height={18} />
            </span>
            <span className="appbar-title">
              <span className="appbar-name">Developer Portal</span>
              <span className="appbar-sub">Restricted Authorization Required</span>
            </span>
          </div>
        </header>

        <div className="superadmin-container" style={{ alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
          <div style={{ maxWidth: 440, width: '100%' }}>
            <div
              className="panel"
              style={{
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 16,
                border: '1px solid color-mix(in srgb, var(--coral) 40%, var(--hairline))',
                background: 'radial-gradient(140% 120% at 50% 0%, var(--coral-ghost), var(--surface))',
              }}
            >
              <span className="row-ico coral" style={{ width: 56, height: 56, borderRadius: 20 }}>
                <IconLock width={26} height={26} />
              </span>
              <div>
                <h2 style={{ fontSize: '1.3rem', color: 'var(--text)' }}>Developer Access Only</h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-3)', marginTop: 4 }}>
                  This route provides unrestricted full database access across all tenants. Enter the Developer PIN to proceed.
                </p>
              </div>

              {pinError && <Notice tone="danger">{pinError}</Notice>}

              <form onSubmit={handleUnlockPin} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input
                  type="password"
                  placeholder="Enter Developer PIN"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--hairline)',
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                    fontSize: '1.1rem',
                    textAlign: 'center',
                    letterSpacing: '0.2em',
                  }}
                />
                <button type="submit" className="primary lg">
                  Unlock Developer Portal
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="superadmin-shell">
      <header className="appbar">
        <div className="appbar-inner" style={{ maxWidth: 1120 }}>
          <span className="row-ico coral" style={{ width: 34, height: 34, borderRadius: 10, flex: 'none' }}>
            <IconShield width={16} height={16} />
          </span>
          <span className="appbar-title">
            <span className="appbar-name" style={{ fontSize: '1.15rem' }}>Developer Super Admin</span>
            <span className="appbar-sub" style={{ fontSize: '0.74rem' }}>Unrestricted Multi-Tenant Database Console</span>
          </span>
        </div>
      </header>

      <div className="superadmin-container">
        {/* DEVELOPER STATUS BAR */}
        <div
          className="panel"
          style={{
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--coral) 15%, var(--surface)), var(--surface))',
            border: '1px solid color-mix(in srgb, var(--coral) 30%, var(--hairline))',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="row-ico coral" style={{ width: 42, height: 42, borderRadius: 'var(--r-sm)' }}>
              <IconShield width={20} height={20} />
            </span>
            <div>
              <div style={{ fontFamily: 'var(--display)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' }}>
                Database Super Admin
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
                RLS Bypassed · Master Service Role {serviceKey ? 'Active' : 'Unset'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="sec-link"
              onClick={() => {
                setKeyInput(serviceKey);
                setKeySheet(true);
              }}
              style={{ fontSize: '0.78rem' }}
            >
              <IconKey width={13} height={13} style={{ marginRight: 4 }} />
              {serviceKey ? 'Service Key Set' : 'Configure Key'}
            </button>
            <button
              type="button"
              className="sec-link"
              onClick={() => {
                setDeveloperUnlocked(false);
                setUnlocked(false);
              }}
              style={{ fontSize: '0.78rem', color: 'var(--coral)' }}
            >
              Lock Portal
            </button>
          </div>
        </div>

        {/* Global 4-Metric Grid */}
        <div className="stats four">
          <Stat k="All Groups" v={groups.length} s="All DB Tenants" tone="mint" />
          <Stat k="All Members" v={members.length} s="Across All Groups" tone="mint" />
          <Stat k="Loans Out" v={loans.length} s={formatPaise(totalLentPaise)} tone="amber" />
          <Stat k="Total Deposited" v={formatPaise(totalContributionsPaise)} s={`${contributions.length} rows`} tone="mint" />
        </div>
      </div>

      {actionError && <Notice tone="danger">{actionError}</Notice>}
      {actionSuccess && <Notice tone="good">{actionSuccess}</Notice>}

      {!serviceKey && (
        <Notice tone="warn">
          <strong>Service Role Key Required:</strong> To bypass Row Level Security (RLS) and edit/delete any data across tenants, provide your Supabase <code>service_role</code> key.
          <button
            type="button"
            className="sec-link"
            style={{ marginLeft: 8, textDecoration: 'underline' }}
            onClick={() => setKeySheet(true)}
          >
            Enter Key
          </button>
        </Notice>
      )}

      {/* Tabs & Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Segments
          value={tab}
          options={[
            { value: 'groups', label: 'All Groups', count: groups.length },
            { value: 'members', label: 'All Members', count: filteredMembers.length },
            { value: 'loans', label: 'Loans', count: filteredLoans.length },
            { value: 'contributions', label: 'Deposits', count: filteredContributions.length },
            { value: 'bank', label: 'Bank Statements', count: filteredBankStatements.length },
            { value: 'expenses', label: 'Expenses', count: filteredExpenses.length },
            { value: 'audit', label: 'Audit History', count: filteredAuditRows.length },
            { value: 'health', label: 'Health Audit' },
            { value: 'backup', label: 'JSON Backup' },
          ]}
          onChange={(t) => {
            haptic(10);
            setTab(t as typeof tab);
          }}
        />

        {/* Polished Controls Bar with Group Filter & Search */}
        {tab !== 'health' && tab !== 'backup' && (
          <div
            className="superadmin-controls"
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
              background: 'var(--surface)',
              padding: 10,
              borderRadius: 'var(--r)',
              border: '1px solid var(--hairline)',
            }}
          >
            <select
              value={filterGroupId}
              onChange={(e) => setFilterGroupId(e.target.value)}
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--hairline)',
                borderRadius: 'var(--r-sm)',
                padding: '9px 12px',
                color: 'var(--text)',
                fontSize: '0.85rem',
                minWidth: 160,
              }}
            >
              <option value="all">Filter: All Groups ({groups.length})</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>

            <input
              type="text"
              placeholder="Search records by name, phone, or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1,
                minWidth: 160,
                background: 'var(--surface-2)',
                border: '1px solid var(--hairline)',
                borderRadius: 'var(--r-sm)',
                padding: '9px 14px',
                color: 'var(--text)',
                fontSize: '0.85rem',
              }}
            />

            <button
              type="button"
              className="primary"
              onClick={() => void refreshAll()}
              disabled={loading}
              style={{ padding: '9px 16px', fontSize: '0.82rem', borderRadius: 'var(--r-sm)', whiteSpace: 'nowrap' }}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        )}

        {/* BULK ACTION BAR */}
        {tab !== 'health' && tab !== 'backup' && (
          (() => {
            const currentTabItems =
              tab === 'groups'
                ? filteredGroups
                : tab === 'members'
                ? filteredMembers
                : tab === 'loans'
                ? filteredLoans
                : tab === 'contributions'
                ? filteredContributions
                : tab === 'bank'
                ? filteredBankStatements
                : tab === 'expenses'
                ? filteredExpenses
                : filteredAuditRows;

            const visibleIds = currentTabItems.map((item) => String(item.id));
            if (visibleIds.length === 0) return null;

            const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
            const selectedCount = selectedIds.length;

            const entityLabel =
              tab === 'groups'
                ? 'group'
                : tab === 'members'
                ? 'member'
                : tab === 'loans'
                ? 'loan'
                : tab === 'contributions'
                ? 'contribution'
                : tab === 'bank'
                ? 'bank statement'
                : tab === 'expenses'
                ? 'expense'
                : 'audit log';

            const tableName =
              tab === 'groups'
                ? 'groups'
                : tab === 'members'
                ? 'members'
                : tab === 'loans'
                ? 'loans'
                : tab === 'contributions'
                ? 'contributions'
                : tab === 'bank'
                ? 'bank_statements'
                : tab === 'expenses'
                ? 'expenses'
                : 'audit_log';

            return (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 10,
                  padding: '8px 14px',
                  borderRadius: 'var(--r-sm)',
                  background: selectedCount > 0 ? 'color-mix(in srgb, var(--coral) 10%, var(--surface))' : 'var(--surface-2)',
                  border: selectedCount > 0 ? '1px solid color-mix(in srgb, var(--coral) 35%, transparent)' : '1px solid var(--hairline)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      className="superadmin-checkbox"
                      checked={allSelected}
                      onChange={() => toggleSelectAll(visibleIds)}
                    />
                    <span>
                      {allSelected ? 'Deselect All' : 'Select All'} ({visibleIds.length})
                    </span>
                  </label>
                  {selectedCount > 0 && (
                    <Tag tone="coral">
                      {selectedCount} selected
                    </Tag>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {selectedCount > 0 && (
                    <>
                      <button
                        type="button"
                        className="sec-link"
                        onClick={() => setSelectedIds([])}
                        style={{ fontSize: '0.78rem' }}
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        className="btn-danger-outline"
                        disabled={bulkDeleting}
                        onClick={() => void handleBulkDelete(tableName, entityLabel)}
                      >
                        <IconTrash width={13} height={13} style={{ marginRight: 6 }} />
                        {bulkDeleting ? 'Deleting…' : `Bulk Delete (${selectedCount})`}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })()
        )}
      </div>

      {/* TAB 1: ALL GROUPS */}
      {tab === 'groups' && (
        <Panel
          title={`All Groups / Tenants (${filteredGroups.length})`}
          action={
            <button
              type="button"
              className="primary"
              onClick={() => {
                setGroupForm({ name: '', monthly_rupees: '1000' });
                setIsNewGroup(true);
                setEditGroup({} as DbGroup);
              }}
              style={{ fontSize: '0.78rem', padding: '5px 12px' }}
            >
              + Create Group
            </button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredGroups.map((g) => {
              const memberCount = members.filter((m) => m.group_id === g.id).length;
              const isChecked = selectedIds.includes(g.id);
              return (
                <div
                  key={g.id}
                  className="superadmin-group-card"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 14,
                    padding: '12px 14px',
                    borderRadius: 'var(--r-sm)',
                    background: isChecked ? 'color-mix(in srgb, var(--coral) 8%, var(--surface))' : 'var(--surface)',
                    border: isChecked ? '1px solid color-mix(in srgb, var(--coral) 40%, transparent)' : '1px solid var(--hairline)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none', marginTop: 2 }}>
                      <input
                        type="checkbox"
                        className="superadmin-checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(g.id)}
                        onClick={(e) => e.stopPropagation()}
                        title={`Select ${g.name}`}
                      />
                      <span className="row-ico violet" style={{ flex: 'none' }}>
                        {initials(g.name)}
                      </span>
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '0.96rem', color: 'var(--text)' }}>{g.name}</strong>
                        <Tag tone={g.setup_complete ? 'mint' : 'amber'}>
                          {g.setup_complete ? 'Setup Done' : 'Setup Pending'}
                        </Tag>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: 3, wordBreak: 'break-all' }}>
                        UUID: <code>{g.id.slice(0, 8)}…</code> · {memberCount} members · Monthly: {formatPaise(g.monthly_contribution_paise || 0)}
                      </div>
                    </div>
                  </div>

                  <div className="group-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
                    <button
                      type="button"
                      className="sec-link"
                      title="Impersonate and switch into this tenant"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleSwitchToGroup(g.id, g.name);
                      }}
                      style={{ fontSize: '0.78rem', color: 'var(--mint)', whiteSpace: 'nowrap' }}
                    >
                      Enter Group →
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Edit Group"
                      onClick={(e) => {
                        e.stopPropagation();
                        setGroupForm({
                          name: g.name,
                          monthly_rupees: String(paiseToRupees(g.monthly_contribution_paise || 0)),
                        });
                        setIsNewGroup(false);
                        setEditGroup(g);
                      }}
                      style={{ width: 32, height: 32 }}
                    >
                      <IconEdit width={13} height={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Delete Group"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteGroup(g.id, g.name);
                      }}
                      style={{ width: 32, height: 32, color: 'var(--coral)' }}
                    >
                      <IconTrash width={13} height={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* TAB 2: ALL MEMBERS */}
      {tab === 'members' && (
        <Panel
          title={`All Members (${filteredMembers.length})`}
          action={
            <button
              type="button"
              className="primary"
              onClick={() => {
                setMemberForm({
                  group_id: filterGroupId !== 'all' ? filterGroupId : groups[0]?.id || '',
                  full_name: '',
                  phone: '',
                  nominee_name: '',
                  nominee_phone: '',
                });
                setIsNewMember(true);
                setEditMember({} as DbMember);
              }}
              style={{ fontSize: '0.78rem', padding: '5px 12px' }}
            >
              + Create Member
            </button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredMembers.map((m) => {
              const currentRole = activeRolesMap.get(`${m.group_id}:${m.id}`) || 'member';
              const isChecked = selectedIds.includes(m.id);
              return (
                <div
                  key={m.id}
                  className="superadmin-group-card"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 14,
                    padding: '12px 14px',
                    borderRadius: 'var(--r-sm)',
                    background: isChecked ? 'color-mix(in srgb, var(--coral) 8%, var(--surface))' : 'var(--surface)',
                    border: isChecked ? '1px solid color-mix(in srgb, var(--coral) 40%, transparent)' : '1px solid var(--hairline)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none', marginTop: 2 }}>
                      <input
                        type="checkbox"
                        className="superadmin-checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(m.id)}
                        onClick={(e) => e.stopPropagation()}
                        title={`Select ${m.full_name}`}
                      />
                      <span className="row-ico mint" style={{ flex: 'none' }}>
                        {initials(m.full_name)}
                      </span>
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '0.96rem', color: 'var(--text)' }}>{m.full_name}</strong>
                        <Tag tone={currentRole === 'member' ? undefined : 'mint'}>
                          {roleLabel(currentRole)}
                        </Tag>
                        <Tag tone="violet">{groupMap.get(m.group_id) || 'Unknown Group'}</Tag>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: 4, wordBreak: 'break-all' }}>
                        Phone: {m.phone || 'None'} · Joined: {fmtDate(m.joined_on)} · ID: <code>{m.id.slice(0, 8)}…</code>
                      </div>
                    </div>
                  </div>

                  <div className="group-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
                    <button
                      type="button"
                      className="sec-link"
                      title="Change Member Role & Office"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRoleMember(m);
                        setSelectedRole(currentRole);
                      }}
                      style={{ fontSize: '0.78rem', color: 'var(--violet)', whiteSpace: 'nowrap' }}
                    >
                      Assign Role
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Edit Member"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMemberForm({
                          group_id: m.group_id,
                          full_name: m.full_name,
                          phone: m.phone || '',
                          nominee_name: m.nominee_name || '',
                          nominee_phone: m.nominee_phone || '',
                        });
                        setIsNewMember(false);
                        setEditMember(m);
                      }}
                      style={{ width: 32, height: 32 }}
                    >
                      <IconEdit width={13} height={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Delete Member"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteMember(m.id, m.full_name);
                      }}
                      style={{ width: 32, height: 32, color: 'var(--coral)' }}
                    >
                      <IconTrash width={13} height={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* TAB 3: ALL LOANS */}
      {tab === 'loans' && (
        <Panel title={`Loans Issued (${filteredLoans.length})`}>
          {filteredLoans.length === 0 ? (
            <div className="empty" style={{ padding: '32px 16px' }}>
              <div className="empty-ico" style={{ width: 44, height: 44 }}>
                <IconShield width={20} height={20} />
              </div>
              <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>No Loans Recorded</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginTop: 4 }}>
                No loan records found for the selected tenant or filter criteria.
              </div>
            </div>
          ) : (
            <List>
              {filteredLoans.map((l) => {
                const isChecked = selectedIds.includes(l.id);
                return (
                  <Row
                    key={l.id}
                    icon={
                      <input
                        type="checkbox"
                        className="superadmin-checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(l.id)}
                        onClick={(e) => e.stopPropagation()}
                        title="Select loan"
                      />
                    }
                    title={
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 650 }}>{memberMap.get(l.borrower_id) || 'Borrower'}</span>
                        <Tag tone="amber">{l.status}</Tag>
                      </span>
                    }
                    sub={`Group: ${groupMap.get(l.group_id) || 'Unknown'} · Purpose: ${l.purpose || 'None'} · Date: ${fmtDate(l.requested_at)}`}
                    amount={formatPaise(l.principal_paise)}
                    amountTone="coral"
                    note={
                      <button
                        type="button"
                        className="icon-btn"
                        title="Delete Loan"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!adminClient) return;
                          if (!window.confirm('Delete this loan record permanently?')) return;
                          await adminClient.from('loans').delete().eq('id', l.id);
                          await refreshAll();
                        }}
                        style={{ width: 30, height: 30, color: 'var(--coral)' }}
                      >
                        <IconTrash width={12} height={12} />
                      </button>
                    }
                  />
                );
              })}
            </List>
          )}
        </Panel>
      )}

      {/* TAB 4: ALL CONTRIBUTIONS */}
      {tab === 'contributions' && (
        <Panel title={`Contributions Record (${filteredContributions.length})`}>
          <List>
            {filteredContributions.map((c) => {
              const isChecked = selectedIds.includes(c.id);
              return (
                <Row
                  key={c.id}
                  icon={
                    <input
                      type="checkbox"
                      className="superadmin-checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelect(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      title="Select contribution"
                    />
                  }
                  title={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 650 }}>{memberMap.get(c.member_id) || 'Member'}</span>
                      <Tag tone="mint">{c.method}</Tag>
                    </span>
                  }
                  sub={`Group: ${groupMap.get(c.group_id) || 'Unknown'} · Paid On: ${fmtDate(c.paid_on)}`}
                  amount={formatPaise(c.amount_paise)}
                  amountTone="mint"
                  note={
                    <button
                      type="button"
                      className="icon-btn"
                      title="Delete Contribution"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!adminClient) return;
                        if (!window.confirm('Delete this contribution record permanently?')) return;
                        await adminClient.from('contributions').delete().eq('id', c.id);
                        await refreshAll();
                      }}
                      style={{ width: 30, height: 30, color: 'var(--coral)' }}
                    >
                      <IconTrash width={12} height={12} />
                    </button>
                  }
                />
              );
            })}
          </List>
        </Panel>
      )}

      {/* TAB 5: BANK RECONCILIATION & STATEMENTS */}
      {tab === 'bank' && (
        <Panel title={`Bank Statements (${filteredBankStatements.length})`}>
          {filteredBankStatements.length === 0 ? (
            <div className="empty" style={{ padding: '32px 16px' }}>
              <div className="empty-ico" style={{ width: 44, height: 44 }}>
                <IconBank width={20} height={20} />
              </div>
              <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>No Bank Statements</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginTop: 4 }}>
                No bank statements uploaded for the selected group.
              </div>
            </div>
          ) : (
            <List>
              {filteredBankStatements.map((b) => {
                const isChecked = selectedIds.includes(b.id);
                return (
                  <Row
                    key={b.id}
                    icon={
                      <input
                        type="checkbox"
                        className="superadmin-checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(b.id)}
                        onClick={(e) => e.stopPropagation()}
                        title="Select statement"
                      />
                    }
                    title={
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 650 }}>{groupMap.get(b.group_id) || 'Unknown Group'}</span>
                        <Tag tone={b.difference_paise === 0 ? 'mint' : 'coral'}>
                          {b.difference_paise === 0 ? 'Balanced' : `Diff: ${formatPaise(b.difference_paise)}`}
                        </Tag>
                      </span>
                    }
                    sub={`As of: ${fmtDate(b.as_of)} · Closing: ${formatPaise(b.closing_balance_paise)} · Expected: ${formatPaise(b.expected_balance_paise)} ${b.note ? `· ${b.note}` : ''}`}
                    note={
                      <button
                        type="button"
                        className="icon-btn"
                        title="Delete Statement"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!adminClient) return;
                          if (!window.confirm('Delete this bank statement entry permanently?')) return;
                          await adminClient.from('bank_statements').delete().eq('id', b.id);
                          await refreshAll();
                        }}
                        style={{ width: 30, height: 30, color: 'var(--coral)' }}
                      >
                        <IconTrash width={12} height={12} />
                      </button>
                    }
                  />
                );
              })}
            </List>
          )}
        </Panel>
      )}

      {/* TAB 6: EXPENSES LEDGER */}
      {tab === 'expenses' && (
        <Panel title={`Expenses Ledger (${filteredExpenses.length})`}>
          {filteredExpenses.length === 0 ? (
            <div className="empty" style={{ padding: '32px 16px' }}>
              <div className="empty-ico" style={{ width: 44, height: 44 }}>
                <IconExpenses width={20} height={20} />
              </div>
              <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>No Expenses Recorded</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginTop: 4 }}>
                No group expenses found matching current filter.
              </div>
            </div>
          ) : (
            <List>
              {filteredExpenses.map((exp) => {
                const isChecked = selectedIds.includes(exp.id);
                return (
                  <Row
                    key={exp.id}
                    icon={
                      <input
                        type="checkbox"
                        className="superadmin-checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(exp.id)}
                        onClick={(e) => e.stopPropagation()}
                        title="Select expense"
                      />
                    }
                    title={
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 650 }}>{exp.description}</span>
                        <Tag tone={exp.status === 'approved' || exp.status === 'paid' ? 'mint' : exp.status === 'rejected' ? 'coral' : 'amber'}>
                          {exp.status}
                        </Tag>
                        <Tag tone="violet">{exp.category}</Tag>
                      </span>
                    }
                    sub={`Group: ${groupMap.get(exp.group_id) || 'Unknown'} · Method: ${exp.method} · Date: ${fmtDate(exp.incurred_on)}`}
                    amount={formatPaise(exp.amount_paise)}
                    amountTone="coral"
                    note={
                      <button
                        type="button"
                        className="icon-btn"
                        title="Delete Expense"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!adminClient) return;
                          if (!window.confirm('Delete this expense permanently?')) return;
                          await adminClient.from('expenses').delete().eq('id', exp.id);
                          await refreshAll();
                        }}
                        style={{ width: 30, height: 30, color: 'var(--coral)' }}
                      >
                        <IconTrash width={12} height={12} />
                      </button>
                    }
                  />
                );
              })}
            </List>
          )}
        </Panel>
      )}

      {/* TAB 7: GLOBAL AUDIT HISTORY */}
      {tab === 'audit' && (
        <Panel title={`Audit History (Last ${filteredAuditRows.length} Events)`}>
          {filteredAuditRows.length === 0 ? (
            <div className="empty" style={{ padding: '32px 16px' }}>
              <div className="empty-ico" style={{ width: 44, height: 44 }}>
                <IconAudit width={20} height={20} />
              </div>
              <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>No Audit Logs Found</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginTop: 4 }}>
                The append-only database audit log has no events matching your search.
              </div>
            </div>
          ) : (
            <List>
              {filteredAuditRows.map((a) => {
                const isChecked = selectedIds.includes(String(a.id));
                return (
                  <Row
                    key={a.id}
                    icon={
                      <input
                        type="checkbox"
                        className="superadmin-checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(String(a.id))}
                        onClick={(e) => e.stopPropagation()}
                        title="Select audit entry"
                      />
                    }
                    title={
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Tag tone={a.action === 'INSERT' ? 'mint' : a.action === 'DELETE' ? 'coral' : 'amber'}>
                          {a.action}
                        </Tag>
                        <strong style={{ fontSize: '0.92rem' }}>{a.table_name}</strong>
                        <span className="dim" style={{ fontSize: '0.78rem' }}>#{a.id}</span>
                      </span>
                    }
                    sub={`Time: ${fmtDateTime(a.occurred_at)} (${ago(a.occurred_at)}) · Row ID: ${String(a.row_id).slice(0, 10)}…`}
                    note={
                      <button
                        type="button"
                        className="sec-link"
                        onClick={() => setSelectedAudit(a)}
                        style={{ fontSize: '0.76rem', color: 'var(--mint)' }}
                      >
                        Inspect JSON
                      </button>
                    }
                  />
                );
              })}
            </List>
          )}
        </Panel>
      )}

      {/* TAB 8: INTEGRITY & HEALTH AUDIT */}
      {tab === 'health' && (
        <Panel
          title="Multi-Tenant Integrity & Health Audit"
          action={
            <button
              type="button"
              className="sec-link"
              onClick={runHealthAudit}
              disabled={checkingHealth}
            >
              <IconWrench width={13} height={13} style={{ marginRight: 4 }} />
              Re-run Audit
            </button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {healthIssues.map((issue, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: 14,
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--hairline)',
                  background:
                    issue.severity === 'danger'
                      ? 'color-mix(in srgb, var(--coral) 12%, var(--surface))'
                      : issue.severity === 'warn'
                      ? 'color-mix(in srgb, var(--amber) 12%, var(--surface))'
                      : 'color-mix(in srgb, var(--mint) 12%, var(--surface))',
                }}
              >
                <Tag tone={issue.severity === 'good' ? 'mint' : issue.severity === 'warn' ? 'amber' : 'coral'}>
                  {issue.severity.toUpperCase()}
                </Tag>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650, color: 'var(--text)', fontSize: '0.92rem' }}>
                    {issue.title} {issue.tenant && <span className="dim">({issue.tenant})</span>}
                  </div>
                  <div style={{ color: 'var(--text-2)', fontSize: '0.82rem', marginTop: 3 }}>
                    {issue.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* TAB 6: JSON BACKUP EXPORT */}
      {tab === 'backup' && (
        <Panel title="Full Database Backup & Disaster Recovery">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ color: 'var(--text-2)', fontSize: '0.88rem', margin: 0 }}>
              Export the entire multi-tenant platform database including groups, active members, role assignments, loans, and all contribution records into an offline JSON snapshot.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="primary lg" onClick={handleExportBackup}>
                <IconDownload width={16} height={16} style={{ marginRight: 8 }} />
                Export Full Database JSON Backup
              </button>
            </div>
          </div>
        </Panel>
      )}

      {/* MODAL 1: SERVICE ROLE KEY CONFIGURATION */}
      <Sheet open={keySheet} title="Supabase Service Role Key" onClose={() => setKeySheet(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Notice tone="warn">
            The <code>service_role</code> key bypasses all Postgres Row-Level Security policies. It is stored in local storage for this session and enables full developer CRUD.
          </Notice>
          <Field label="Service Role Key (from Supabase Project Settings > API)">
            <textarea
              rows={4}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              style={{
                width: '100%',
                padding: '10px 12px',
                fontFamily: 'var(--mono)',
                fontSize: '0.8rem',
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--hairline)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
              }}
            />
          </Field>
          <button type="button" className="primary lg" onClick={handleSaveKey}>
            Apply Service Role Key
          </button>
        </div>
      </Sheet>

      {/* MODAL 2: EDIT / CREATE GROUP */}
      {editGroup && (
        <Sheet
          open={Boolean(editGroup)}
          title={isNewGroup ? 'Create New Group' : `Edit Group: ${editGroup.name}`}
          onClose={() => setEditGroup(null)}
        >
          <form onSubmit={handleSaveGroup} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Group Name">
              <input
                type="text"
                required
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                placeholder="e.g. Friends Savings Sangam"
              />
            </Field>
            <Field label="Monthly Contribution (₹)">
              <input
                type="number"
                required
                value={groupForm.monthly_rupees}
                onChange={(e) => setGroupForm({ ...groupForm, monthly_rupees: e.target.value })}
              />
            </Field>
            <button type="submit" className="primary lg" disabled={loading}>
              {loading ? 'Saving…' : isNewGroup ? 'Create Group' : 'Save Changes'}
            </button>
          </form>
        </Sheet>
      )}

      {/* MODAL 3: EDIT / CREATE MEMBER */}
      {editMember && (
        <Sheet
          open={Boolean(editMember)}
          title={isNewMember ? 'Create Member' : `Edit Member: ${editMember.full_name}`}
          onClose={() => setEditMember(null)}
        >
          <form onSubmit={handleSaveMember} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Assigned Group">
              <select
                value={memberForm.group_id}
                onChange={(e) => setMemberForm({ ...memberForm, group_id: e.target.value })}
                required
              >
                <option value="">Select a group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Full Name">
              <input
                type="text"
                required
                value={memberForm.full_name}
                onChange={(e) => setMemberForm({ ...memberForm, full_name: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                value={memberForm.phone}
                onChange={(e) => setMemberForm({ ...memberForm, phone: e.target.value })}
                placeholder="e.g. 9876543210"
              />
            </Field>
            <Field label="Nominee Name">
              <input
                type="text"
                value={memberForm.nominee_name}
                onChange={(e) => setMemberForm({ ...memberForm, nominee_name: e.target.value })}
              />
            </Field>
            <Field label="Nominee Phone">
              <input
                type="tel"
                value={memberForm.nominee_phone}
                onChange={(e) => setMemberForm({ ...memberForm, nominee_phone: e.target.value })}
              />
            </Field>
            <button type="submit" className="primary lg" disabled={loading}>
              {loading ? 'Saving…' : isNewMember ? 'Create Member' : 'Save Changes'}
            </button>
          </form>
        </Sheet>
      )}

      {/* MODAL 4: ROLE & OFFICE ASSIGNMENT */}
      {roleMember && (
        <Sheet
          open={Boolean(roleMember)}
          title={`Assign Role: ${roleMember.full_name}`}
          onClose={() => setRoleMember(null)}
        >
          <form onSubmit={handleAssignRole} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Notice tone="good">
              Group: <strong>{groupMap.get(roleMember.group_id)}</strong>. Changing this role updates office assignments and handles turnover automatically.
            </Notice>
            <Field label="Select Office / Role">
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as Role)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 'var(--r-sm)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--hairline)',
                  color: 'var(--text)',
                }}
              >
                <option value="member">Regular Member (No office)</option>
                <option value="admin">Admin (Group Administrator)</option>
                <option value="cashier">Cashier (Holds cash float & records entries)</option>
                <option value="accountant">Accountant (Bank reconciliation & ledger)</option>
              </select>
            </Field>
            <button type="submit" className="primary lg" disabled={loading}>
              {loading ? 'Updating…' : 'Save Office Assignment'}
            </button>
          </form>
        </Sheet>
      )}

      {/* MODAL 5: AUDIT LOG INSPECTOR */}
      {selectedAudit && (
        <Sheet
          open={Boolean(selectedAudit)}
          title={`Audit Event #${selectedAudit.id}: ${selectedAudit.action} on ${selectedAudit.table_name}`}
          onClose={() => setSelectedAudit(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Tag tone={selectedAudit.action === 'INSERT' ? 'mint' : selectedAudit.action === 'DELETE' ? 'coral' : 'amber'}>
                {selectedAudit.action}
              </Tag>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>
                {fmtDateTime(selectedAudit.occurred_at)} ({ago(selectedAudit.occurred_at)})
              </span>
            </div>

            <div style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>
              <strong>Row ID:</strong> <code>{selectedAudit.row_id}</code>
            </div>

            {selectedAudit.changed_keys && selectedAudit.changed_keys.length > 0 && (
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-3)', marginBottom: 4 }}>
                  CHANGED KEYS:
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {selectedAudit.changed_keys.map((k) => (
                    <Tag key={k} tone="violet">{k}</Tag>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-3)', marginBottom: 4 }}>
                NEW DATA SNAPSHOT:
              </div>
              <pre
                style={{
                  background: 'var(--surface-2)',
                  padding: 12,
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--hairline)',
                  fontSize: '0.76rem',
                  maxHeight: 200,
                  overflow: 'auto',
                  margin: 0,
                  color: 'var(--text)',
                }}
              >
                {JSON.stringify(selectedAudit.new_data || {}, null, 2)}
              </pre>
            </div>

            {selectedAudit.old_data && (
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-3)', marginBottom: 4 }}>
                  OLD DATA SNAPSHOT:
                </div>
                <pre
                  style={{
                    background: 'var(--surface-2)',
                    padding: 12,
                    borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--hairline)',
                    fontSize: '0.76rem',
                    maxHeight: 180,
                    overflow: 'auto',
                    margin: 0,
                    color: 'var(--text-3)',
                  }}
                >
                  {JSON.stringify(selectedAudit.old_data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </Sheet>
      )}
      </div>
    </div>
  );
}
