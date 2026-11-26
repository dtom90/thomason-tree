import { EditDatumFormCreator, NewRelFormCreator, SelectField } from '../types/form'
import * as icons from './icons'


export function getHtmlNew(form_creator: NewRelFormCreator) {
  return (` 
    <form id="familyForm" class="f3-form">
      ${closeBtn()}
      <h3 class="f3-form-title">${form_creator.title}</h3>

      <div class="f3-form-fields">
        ${fields(form_creator)}
      </div>
      
      <div class="f3-form-buttons">
        <button type="button" class="f3-cancel-btn">Cancel</button>
        <button type="submit">Save</button>
      </div>

      ${form_creator.linkExistingRelative ? addLinkExistingRelative(form_creator) : ''}
    </form>
  `)
}

export function getHtmlEdit(form_creator: EditDatumFormCreator) {
  return (` 
    <form id="familyForm" class="f3-form ${form_creator.editable ? '' : 'non-editable'}">
      ${closeBtn()}
      <div class="f3-form-header-actions">
        ${form_creator.no_edit ? spaceDiv() : editBtn(form_creator)}
      </div>

      <div class="f3-form-fields">
        ${fields(form_creator)}
      </div>
      
      <div class="f3-form-buttons">
        <button type="button" class="f3-cancel-btn">Cancel</button>
        <button type="submit">Save</button>
      </div>

      ${!form_creator.no_edit ? addRelativeBtn(form_creator) : ''}

      ${form_creator.linkExistingRelative ? addLinkExistingRelative(form_creator) : ''}

      <div class="f3-form-danger">
        ${removeRelativeBtn(form_creator)}
        ${deleteBtn(form_creator)}
      </div>
    </form>
  `)
}

function deleteBtn(form_creator: EditDatumFormCreator) {
  return (`
    <button type="button" class="f3-delete-btn" ${form_creator.can_delete ? '' : 'disabled'}>
      Delete person
    </button>
  `)
}

function removeRelativeBtn(form_creator: EditDatumFormCreator) {
  return (`
    <button type="button" class="f3-remove-relative-btn${form_creator.removeRelativeActive ? ' active' : ''}">
      ${form_creator.removeRelativeActive ? 'Cancel remove' : 'Remove relation'}
    </button>
  `)
}

function addRelativeBtn(form_creator: EditDatumFormCreator) {
  const active = form_creator.addRelativeActive
  return (`
    <button type="button" class="f3-add-relative-btn${active ? ' active' : ''}">
      ${active ? icons.userPlusCloseSvgIcon() : icons.userPlusSvgIcon()}
      <span>${active ? 'Cancel' : 'Add relative'}</span>
    </button>
  `)
}

function editBtn(form_creator: EditDatumFormCreator) {
  return (`
    <span class="f3-edit-btn" title="${form_creator.editable ? 'Lock editing' : 'Edit'}">
      ${form_creator.editable ? icons.pencilOffSvgIcon() : icons.pencilSvgIcon()}
    </span>
  `)
}

function isNameField(field: { id: string }) {
  return field.id === 'first name' || field.id === 'last name'
}

function genderFieldHtml(form_creator: EditDatumFormCreator | NewRelFormCreator) {
  if (form_creator.editable) {
    return (`
      <div class="f3-form-field">
        <label>${form_creator.gender_field.label}</label>
        <div class="f3-radio-group">
          ${form_creator.gender_field.options.map(option => (`
            <label>
              <input type="radio" name="${form_creator.gender_field.id}" 
                value="${option.value}" 
                ${option.value === form_creator.gender_field.initial_value ? 'checked' : ''}
                ${form_creator.gender_field.disabled ? 'disabled' : ''}
              >
              <span>${option.label}</span>
            </label>
          `)).join('')}
        </div>
      </div>
    `)
  }

  const gender = form_creator.gender_field
  const gender_label =
    gender.options.find(option => option.value === gender.initial_value)?.label ||
    gender.initial_value ||
    ''
  return (`
    <div class="f3-info-field">
      <span class="f3-info-field-label">${gender.label}</span>
      <span class="f3-info-field-value">${gender_label}</span>
    </div>
  `)
}

function fields(form_creator: EditDatumFormCreator | NewRelFormCreator) {
  if (!form_creator.editable) return infoField()
  let fields_html = ''
  let gender_inserted = false
  form_creator.fields.forEach((field, index) => {
    if (field.type === 'text' || field.type === 'date') {
      const value =
        field.type === 'date' ? dateInputValue(field.initial_value) : (field.initial_value || '')
      fields_html += `
      <div class="f3-form-field">
        <label>${field.label}</label>
        <input type="${field.type}" 
          name="${field.id}" 
          value="${value}"
          placeholder="${field.label}">
      </div>`
    } else if (field.type === 'textarea') {
      fields_html += `
      <div class="f3-form-field">
        <label>${field.label}</label>
        <textarea name="${field.id}" 
          placeholder="${field.label}">${field.initial_value || ''}</textarea>
      </div>`
    } else if (field.type === 'select') {
      const select_field = field as SelectField
      fields_html += `
      <div class="f3-form-field">
        <label>${select_field.label}</label>
        <select name="${select_field.id}" value="${select_field.initial_value || ''}">
          <option value="">${select_field.placeholder || `Select ${select_field.label}`}</option>
          ${select_field.options.map((option) => `<option ${option.value === select_field.initial_value ? 'selected' : ''} value="${option.value}">${option.label}</option>`).join('')}
        </select>
      </div>`
    } else if (field.type === 'rel_reference') {
      fields_html += `
      <div class="f3-form-field">
        <label>${field.label} - <i>${field.rel_label}</i></label>
        <input type="text" 
          name="${field.id}" 
          value="${field.initial_value || ''}"
          placeholder="${field.label}">
      </div>`
    }

    const next = form_creator.fields[index + 1]
    if (!gender_inserted && isNameField(field) && (!next || !isNameField(next))) {
      fields_html += genderFieldHtml(form_creator)
      gender_inserted = true
    }
  })
  if (!gender_inserted) fields_html += genderFieldHtml(form_creator)
  return fields_html

  function infoField() {
    const name_parts = form_creator.fields
      .filter(isNameField)
      .map(field => String(field.initial_value || '').trim())
      .filter(Boolean)
    let fields_html = `
      <div class="f3-info-field">
        <span class="f3-info-field-label">Name</span>
        <span class="f3-info-field-value">${name_parts.join(' ')}</span>
      </div>`
    fields_html += genderFieldHtml(form_creator)

    form_creator.fields.forEach(field => {
      if (isNameField(field)) return
      if (field.type === 'rel_reference') {
        if (!field.initial_value) return
        fields_html += `
        <div class="f3-info-field">
          <span class="f3-info-field-label">${field.label} - <i>${field.rel_label}</i></span>
          <span class="f3-info-field-value">${field.initial_value || ''}</span>
        </div>`
      } else if (field.type === 'select') {
        const select_field = field as SelectField
        if (!field.initial_value) return
        fields_html += `
        <div class="f3-info-field">
          <span class="f3-info-field-label">${select_field.label}</span>
          <span class="f3-info-field-value">${select_field.options.find(option => option.value === select_field.initial_value)?.label || ''}</span>
        </div>`
      } else {
        const value =
          field.type === 'date'
            ? formatDisplayDate(field.initial_value)
            : (field.initial_value || '')
        fields_html += `
        <div class="f3-info-field">
          <span class="f3-info-field-label">${field.label}</span>
          <span class="f3-info-field-value">${value}</span>
        </div>`
      }
    })
    return fields_html
  }
}

function addLinkExistingRelative(form_creator: EditDatumFormCreator | NewRelFormCreator) {
  const title = form_creator.linkExistingRelative.hasOwnProperty('title') ? form_creator.linkExistingRelative.title : 'Profile already exists?'
  const select_placeholder = form_creator.linkExistingRelative.hasOwnProperty('select_placeholder') ? form_creator.linkExistingRelative.select_placeholder : 'Select profile'
  const options = form_creator.linkExistingRelative.options as SelectField['options']
  return (`
    <div class="f3-link-existing-relative">
      <label>${title}</label>
      <select>
        <option value="">${select_placeholder}</option>
        ${options.map(option => `<option value="${option.value}">${option.label}</option>`).join('')}
      </select>
    </div>
  `)
}


function dateInputValue(value: unknown) {
  const raw = String(value ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  return ''
}

function formatDisplayDate(value: unknown) {
  const raw = String(value ?? '').trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return raw
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function closeBtn() {
  return (`
    <button type="button" class="f3-close-btn" aria-label="Close">
      ×
    </button>
  `)
}

function spaceDiv() {
  return `<div style="height: 24px;"></div>`
}
