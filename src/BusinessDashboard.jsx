import React, { useState, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts'

const COLORS = ['#f29ff5', '#95f5e2', '#4cd0e1', '#bbff78', '#bfaa80', '#e8c15a', '#b05a5a']

export default function BusinessDashboard({ doc, setDoc }) {
  const [selectedPeriod, setSelectedPeriod] = useState('month')
  const [searchQuery, setSearchQuery] = useState('')
  const [showNotifications, setShowNotifications] = useState(false)
  
  // Mock data for charts - in a real app these would come from an API
  const revenueData = useMemo(() => [
    { month: 'Jan', revenue: 4000, profit: 2400 },
    { month: 'Feb', revenue: 3000, profit: 1398 },
    { month: 'Mar', revenue: 2000, profit: 9800 },
    { month: 'Apr', revenue: 2780, profit: 3908 },
    { month: 'May', revenue: 1890, profit: 4800 },
    { month: 'Jun', revenue: 2390, profit: 3800 },
    { month: 'Jul', revenue: 3490, profit: 4300 },
    { month: 'Aug', revenue: 4200, profit: 5100 },
    { month: 'Sep', revenue: 5100, profit: 6200 },
    { month: 'Oct', revenue: 6300, profit: 7100 },
    { month: 'Nov', revenue: 7200, profit: 8200 },
    { month: 'Dec', revenue: 8400, profit: 9500 },
  ], [])

  const customerData = useMemo(() => [
    { id: 1, name: 'Acme Corp', email: 'contact@acme.com', status: 'Active', revenue: 45000 },
    { id: 2, name: 'Globex Inc', email: 'info@globex.com', status: 'Active', revenue: 32000 },
    { id: 3, name: 'Soylent Corp', email: 'hello@soylent.com', status: 'Inactive', revenue: 18000 },
    { id: 4, name: 'Initech', email: 'support@initech.com', status: 'Active', revenue: 52000 },
    { id: 5, name: 'Umbrella Corp', email: 'contact@umbrella.com', status: 'Active', revenue: 67000 },
    { id: 6, name: 'Cyberdyne', email: 'info@cyberdyne.com', status: 'Pending', revenue: 23000 },
    { id: 7, name: 'Massive Dynamic', email: 'hello@massivedynamic.com', status: 'Active', revenue: 41000 },
    { id: 8, name: 'Stark Ind', email: 'contact@stark.com', status: 'Active', revenue: 89000 },
  ], [])

  const transactionData = useMemo(() => [
    { id: 1, customer: 'Acme Corp', amount: 5200, date: '2024-11-01', status: 'Completed' },
    { id: 2, customer: 'Globex Inc', amount: 3400, date: '2024-11-02', status: 'Completed' },
    { id: 3, customer: 'Initech', amount: 7800, date: '2024-11-03', status: 'Pending' },
    { id: 4, customer: 'Umbrella Corp', amount: 4500, date: '2024-11-04', status: 'Completed' },
    { id: 5, customer: 'Stark Ind', amount: 9200, date: '2024-11-05', status: 'Completed' },
    { id: 6, customer: 'Massive Dynamic', amount: 2300, date: '2024-11-06', status: 'Failed' },
  ], [])

  const pieData = useMemo(() => [
    { name: 'Q1', value: 300 },
    { name: 'Q2', value: 250 },
    { name: 'Q3', value: 200 },
    { name: 'Q4', value: 150 },
  ], [])

  const kpiCards = useMemo(() => [
    { label: 'Total Revenue', value: '$124,500', change: '+12.5%', positive: true },
    { label: 'Active Customers', value: '847', change: '+5.2%', positive: true },
    { label: 'Avg Deal Size', value: '$14,800', change: '-3.1%', positive: false },
    { label: 'Churn Rate', value: '2.3%', change: '-0.5%', positive: true },
  ], [])

  const filteredCustomers = customerData.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredTransactions = transactionData.filter(t =>
    t.customer.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.amount.toString().includes(searchQuery)
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-2)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '12px' }}>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', padding: '8px' }}>
        {kpiCards.map((kpi, i) => (
          <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--line)', padding: '10px', borderRadius: '0' }}>
            <div style={{ color: 'var(--dim)', fontSize: '10px', marginBottom: '4px' }}>{kpi.label}</div>
            <div style={{ fontSize: '18px', fontWeight: '700', color: kpi.positive ? 'var(--lime)' : 'var(--text)' }}>{kpi.value}</div>
            <div style={{ fontSize: '10px', color: kpi.positive ? 'var(--lime)' : 'var(--urgent)' }}>{kpi.change}</div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px', padding: '8px' }}>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', padding: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontWeight: '700' }}>Revenue Trends</span>
            <select 
              className="inp"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              style={{ fontSize: '10px', padding: '2px 6px' }}
            >
              <option value="month">Monthly</option>
              <option value="week">Weekly</option>
              <option value="year">Yearly</option>
            </select>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={revenueData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2c313a" />
              <XAxis dataKey="month" stroke="#8d8478" fontSize={10} />
              <YAxis stroke="#8d8478" fontSize={10} />
              <RechartsTooltip 
                contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text)' }}
              />
              <Line type="monotone" dataKey="revenue" stroke="#f29ff5" strokeWidth={2} dot={{ fill: '#f29ff5' }} />
              <Line type="monotone" dataKey="profit" stroke="#95f5e2" strokeWidth={2} dot={{ fill: '#95f5e2' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', padding: '8px' }}>
          <span style={{ fontWeight: '700', marginBottom: '6px' }}>Quarterly Breakdown</span>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} fill="#8884d8" dataKey="value">
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip 
                contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text)' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tables Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', padding: '8px' }}>
        {/* Customers Table */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', padding: '8px', overflow: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontWeight: '700' }}>Customers</span>
            <input
              className="inp"
              type="text"
              placeholder="Search customers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ fontSize: '10px', padding: '2px 6px', width: '120px' }}
            />
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--dim)' }}>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Email</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Status</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((customer) => (
                <tr key={customer.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '4px 6px' }}>{customer.name}</td>
                  <td style={{ padding: '4px 6px' }}>{customer.email}</td>
                  <td style={{ padding: '4px 6px' }}>
                    <span style={{ 
                      padding: '2px 6px', 
                      borderRadius: '0', 
                      fontSize: '10px',
                      background: customer.status === 'Active' ? 'var(--lime)' : customer.status === 'Inactive' ? 'var(--urgent)' : 'var(--amber)',
                      color: 'var(--bg)'
                    }}>
                      {customer.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--lime)' }}>${customer.revenue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Transactions Table */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', padding: '8px', overflow: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontWeight: '700' }}>Recent Transactions</span>
            <input
              className="inp"
              type="text"
              placeholder="Search transactions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ fontSize: '10px', padding: '2px 6px', width: '120px' }}
            />
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--dim)' }}>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Customer</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Amount</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Date</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((tx) => (
                <tr key={tx.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '4px 6px' }}>{tx.customer}</td>
                  <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--lime)' }}>${tx.amount.toLocaleString()}</td>
                  <td style={{ padding: '4px 6px' }}>{tx.date}</td>
                  <td style={{ padding: '4px 6px' }}>
                    <span style={{ 
                      padding: '2px 6px', 
                      borderRadius: '0', 
                      fontSize: '10px',
                      background: tx.status === 'Completed' ? 'var(--lime)' : tx.status === 'Pending' ? 'var(--amber)' : 'var(--urgent)',
                      color: 'var(--bg)'
                    }}>
                      {tx.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Notifications */}
      <div style={{ padding: '8px' }}>
        <button 
          className="btn"
          onClick={() => setShowNotifications(!showNotifications)}
          style={{ fontSize: '10px', padding: '4px 10px' }}
        >
          🔔 Notifications {showNotifications ? '▲' : '▼'}
        </button>
        
        {showNotifications && (
          <div style={{ 
            marginTop: '6px', 
            background: 'var(--bg-3)', 
            border: '1px solid var(--line)', 
            padding: '8px', 
            borderRadius: '0' 
          }}>
            <div style={{ marginBottom: '4px', color: 'var(--mint)' }}>✅ New customer signed up: {customerData[0].name}</div>
            <div style={{ marginBottom: '4px', color: 'var(--amber)' }}>⚠️ Transaction #3 pending review</div>
            <div style={{ color: 'var(--lime)' }}>🎉 Revenue target exceeded by 15%</div>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div style={{ padding: '8px', borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button className="btn" style={{ fontSize: '10px', padding: '4px 10px' }}>📊 Generate Report</button>
          <button className="btn" style={{ fontSize: '10px', padding: '4px 10px' }}>📧 Export Customer List</button>
          <button className="btn" style={{ fontSize: '10px', padding: '4px 10px' }}>⚙️ Settings</button>
        </div>
      </div>
    </div>
  )
}
