import { Component, OnInit, VERSION } from '@angular/core';
import { Buffer } from 'buffer';
import { ZipService } from './zip.service';
import * as FileSaver from 'file-saver';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  file$: Subject<any> = new Subject();

  constructor(private zipService: ZipService) { }

  ngOnInit(): void {
    const timestamp = new Date().getTime();
    let count = 0;
    this.file$.subscribe((file: Blob) => {
      count++;
      console.log(file)
      FileSaver.saveAs(file, `zip-${timestamp}-${count}.zip`);
    })
  }

  async test(e: any) {
    const zip = this.zipService.newZipInstance()
    for (let file of e.target.files) {
      const fileBuffer = await file.arrayBuffer();
      const buffer = new Uint8Array(fileBuffer);
      zip.addFile(file.name, buffer)
    }
    zip.getZipFile$(this.file$)
    
  }
}
