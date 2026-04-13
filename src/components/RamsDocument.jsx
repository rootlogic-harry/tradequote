import React from 'react';
import { getRiskLevel } from '../utils/ramsBuilder.js';
import { WORK_TYPE_LABELS } from '../data/ramsConstants.js';
import { COMMON_PPE } from '../data/ramsDefaults.js';
import RamsRiskMatrix from './rams/RamsRiskMatrix.jsx';

function formatDate(iso) {
  if (!iso) return '\u2014';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function RamsDocument({ rams, profile, showPhotos = true }) {
  if (!rams) return null;

  const groupedStages = {};
  (rams.workStages || []).forEach(s => {
    const key = s.type || 'custom';
    if (!groupedStages[key]) groupedStages[key] = [];
    groupedStages[key].push(s.stage);
  });

  const ppeLabels = COMMON_PPE.filter(p => (rams.ppeRequirements || []).includes(p.id));

  return (
    <div id="rams-document" className="bg-white text-gray-900 px-20 py-16 text-sm leading-relaxed" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      {/* Header */}
      <div className="flex justify-between items-start mb-6 border-b-2 border-gray-200 pb-4">
        <div className="flex items-start gap-4">
          {profile?.logo && (
            <img src={profile.logo} alt="Logo" className="max-w-[200px] max-h-[80px] object-contain" />
          )}
          <div>
            <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              {rams.company || profile?.companyName || ''}
            </h1>
            <p className="text-gray-500 text-xs">{profile?.accreditations || ''}</p>
          </div>
        </div>
        <div className="text-right text-xs text-gray-600">
          <p className="text-lg font-bold text-gray-800" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            RISK ASSESSMENT &amp; METHOD STATEMENT
          </p>
          <p>{formatDate(rams.documentDate)}</p>
          <p>{profile?.phone}</p>
          <p>{profile?.email}</p>
        </div>
      </div>

      {/* Reference line */}
      <div className="bg-gray-50 px-4 py-2 rounded mb-6 text-xs font-medium">
        Job ref: {rams.jobNumber} — {rams.client}, {rams.siteAddress}
      </div>

      {/* Job Details table */}
      <div className="mb-8">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Job Details
        </h2>
        <table className="w-full text-sm">
          <tbody>
            {[
              ['Site Address', rams.siteAddress],
              ['Client', rams.client],
              ['Company', rams.company],
              ['Foreman', rams.foreman],
              ['Commencement Date', formatDate(rams.commencementDate)],
              ['Projected Completion', formatDate(rams.projectedCompletionDate)],
              ['Document Date', formatDate(rams.documentDate)],
            ].map(([label, value]) => (
              <tr key={label} className="border-b border-gray-100">
                <td className="py-1 text-gray-500 w-1/3">{label}</td>
                <td className="py-1 text-gray-900 font-medium">{value || '\u2014'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Scope & Method */}
      <div className="mb-8">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Scope of Works &amp; Method Statement
        </h2>

        {rams.workTypes?.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1">Work types:</p>
            <div className="flex flex-wrap gap-1">
              {rams.workTypes.map(wt => (
                <span key={wt} className="bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded">
                  {WORK_TYPE_LABELS[wt] || wt}
                </span>
              ))}
            </div>
          </div>
        )}

        {Object.entries(groupedStages).map(([type, stages]) => (
          <div key={type} className="mb-3">
            <p className="text-xs font-bold text-gray-600 uppercase mb-1">{WORK_TYPE_LABELS[type] || 'Custom'}</p>
            <ol className="list-decimal list-inside space-y-0.5 text-sm text-gray-700">
              {stages.map((s, i) => (
                <li key={i} className="pl-1">{s}</li>
              ))}
            </ol>
          </div>
        ))}

        {rams.methodDescription && (
          <div className="mt-3">
            <p className="text-xs font-bold text-gray-600 uppercase mb-1">Additional Method Description</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{rams.methodDescription}</p>
          </div>
        )}
      </div>

      {/* Organisation / Contact */}
      <div className="mb-8">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Organisation &amp; Contact
        </h2>
        <table className="w-full text-sm">
          <tbody>
            {[
              ['Contact Title', rams.contactTitle],
              ['Contact Name', rams.contactName],
              ['Contact Number', rams.contactNumber],
            ].map(([label, value]) => (
              <tr key={label} className="border-b border-gray-100">
                <td className="py-1 text-gray-500 w-1/3">{label}</td>
                <td className="py-1 text-gray-900 font-medium">{value || '\u2014'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Risk Matrix */}
      <div className="mb-8">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Risk Matrix
        </h2>
        <RamsRiskMatrix />
      </div>

      {/* Risk Assessment Table */}
      <div className="mb-8">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Risk Assessment
        </h2>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100 text-gray-600">
              <th className="border border-gray-200 px-2 py-1 text-left">Task</th>
              <th className="border border-gray-200 px-2 py-1 text-left">Hazard</th>
              <th className="border border-gray-200 px-2 py-1 text-left">Who</th>
              <th className="border border-gray-200 px-2 py-1 text-left">Controls</th>
              <th className="border border-gray-200 px-1 py-1 text-center w-8">L</th>
              <th className="border border-gray-200 px-1 py-1 text-center w-8">C</th>
              <th className="border border-gray-200 px-1 py-1 text-center w-16">Rating</th>
              <th className="border border-gray-200 px-2 py-1 text-left">Further Action</th>
            </tr>
          </thead>
          <tbody>
            {(rams.riskAssessments || []).map(ra => {
              const level = getRiskLevel(ra.riskRating);
              return (
                <tr key={ra.id} className="border-b border-gray-100">
                  <td className="border border-gray-200 px-2 py-1 font-medium">{ra.task}</td>
                  <td className="border border-gray-200 px-2 py-1">{ra.hazardDescription}</td>
                  <td className="border border-gray-200 px-2 py-1">{ra.whoMightBeHarmed}</td>
                  <td className="border border-gray-200 px-2 py-1">
                    {(ra.existingControls || []).join(', ')}
                  </td>
                  <td className="border border-gray-200 px-1 py-1 text-center font-mono">{ra.likelihood}</td>
                  <td className="border border-gray-200 px-1 py-1 text-center font-mono">{ra.consequence}</td>
                  <td className="border border-gray-200 px-1 py-1 text-center">
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] font-bold font-mono"
                      style={{ backgroundColor: level.color }}
                    >
                      {ra.riskRating} {level.label}
                    </span>
                  </td>
                  <td className="border border-gray-200 px-2 py-1">{ra.furtherActionRequired}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Workplace Access */}
      {rams.workplaceAccess && (
        <div className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Workplace Access
          </h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{rams.workplaceAccess}</p>
        </div>
      )}

      {/* Lighting */}
      {rams.workplaceLighting && (
        <div className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Workplace Lighting
          </h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{rams.workplaceLighting}</p>
        </div>
      )}

      {/* PPE */}
      <div className="mb-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Personal Protective Equipment (PPE)
        </h2>
        {ppeLabels.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {ppeLabels.map(p => (
              <span key={p.id} className="bg-gray-100 text-gray-700 text-xs px-3 py-1 rounded flex items-center gap-1">
                <span>{p.icon}</span> {p.label}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 italic">No PPE requirements specified.</p>
        )}
      </div>

      {/* Training */}
      <div className="mb-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Training &amp; Competence
        </h2>
        <p className="text-sm text-gray-700">
          All operatives working on this project are trained and competent for their specific tasks.
          Relevant qualifications and CSCS cards have been verified prior to commencement.
          Site-specific induction will be carried out for all personnel before they begin work.
        </p>
      </div>

      {/* Hazardous Materials */}
      {rams.hazardousMaterials && (
        <div className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Hazardous Materials
          </h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{rams.hazardousMaterials}</p>
        </div>
      )}

      {/* Waste Management */}
      {rams.wasteManagement && (
        <div className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Waste Management
          </h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{rams.wasteManagement}</p>
        </div>
      )}

      {/* Special Control Measures */}
      {rams.specialControlMeasures && (
        <div className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Special Control Measures
          </h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{rams.specialControlMeasures}</p>
        </div>
      )}

      {/* Communication */}
      <div className="mb-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Communication
        </h2>
        {(rams.employeesOnJob?.length > 0 || rams.communicatedEmployees?.length > 0) ? (
          <div className="space-y-2">
            {rams.employeesOnJob?.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Employees on job:</p>
                <p className="text-sm text-gray-700">{rams.employeesOnJob.join(', ')}</p>
              </div>
            )}
            {rams.communicatedEmployees?.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">RAMS communicated to:</p>
                <p className="text-sm text-gray-700">{rams.communicatedEmployees.join(', ')}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500 italic">Personnel to be confirmed.</p>
        )}
      </div>

      {/* Contact Details */}
      <div className="mb-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Emergency Contact Details
        </h2>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="py-1 text-gray-500 w-1/3">{rams.contactTitle || 'Site Contact'}</td>
              <td className="py-1 text-gray-900">{rams.contactName || '\u2014'} — {rams.contactNumber || '\u2014'}</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-1 text-gray-500">Emergency Services</td>
              <td className="py-1 text-gray-900 font-mono font-bold">999</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Site Photos */}
      {showPhotos && rams.photos?.length > 0 && (
        <div className="mt-8 border-t border-gray-200 pt-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-3" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Site Photographs
          </h2>
          <div className="space-y-6">
            {rams.photos.map((p, i) => (
              <div key={i}>
                <img src={p.data} alt={p.label} className="w-full rounded" />
                <p className="text-xs text-gray-400 mt-1">{p.label} — {rams.siteAddress}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t-2 border-gray-200 pt-4 mt-8 text-xs text-gray-500">
        <p className="mb-1">This RAMS must be reviewed and briefed to all site operatives before work commences.</p>
        <p className="mb-1">Review date: Prior to commencement and thereafter as conditions change.</p>
        <p className="mb-1">{rams.foreman || profile?.fullName} — {profile?.accreditations || ''}</p>
        <p className="italic">Document prepared with FastQuote — reviewed and approved by {rams.foreman || profile?.fullName}.</p>
      </div>
    </div>
  );
}
